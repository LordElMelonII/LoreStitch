import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CharacterBookEntry, createEmptyEntry } from '../../../core/models/lorebook.model';
import { RegexTestPanel } from './regex-test-panel';

describe('RegexTestPanel', () => {
  let fixture: ComponentFixture<RegexTestPanel>;

  /** (Re-)binds the entry input; the panel is presentation-only over it. */
  function bindEntry(entry: Partial<CharacterBookEntry>): void {
    fixture.componentRef.setInput('entry', {
      ...createEmptyEntry(0),
      keys: [],
      secondary_keys: [],
      ...entry,
    });
    fixture.detectChanges();
  }

  function panelRoot(): HTMLElement {
    const el = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.test-keys-header');
    assert(el);
    return el;
  }

  function anchorElement(): HTMLElement {
    const el = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.test-panel-anchor');
    assert(el);
    return el;
  }

  function matchRows(): HTMLElement[] {
    return [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.match-row'),
    ];
  }

  /**
   * Collapsed content is inert. jsdom does not reflect the `inert` DOM
   * property, so the attribute Angular binds is the portable read.
   */
  function isInert(el: HTMLElement): boolean {
    return el.inert === true || el.hasAttribute('inert');
  }

  function toggleOpen(): void {
    const toggle = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      '.test-keys-toggle',
    );
    assert(toggle);
    toggle.click();
    fixture.detectChanges();
  }

  function textareaElement(): HTMLTextAreaElement {
    const el = (fixture.nativeElement as HTMLElement).querySelector('textarea');
    assert(el);
    return el;
  }

  /** Types into the sample textarea through the real input event. */
  function typeSample(text: string): void {
    const el = textareaElement();
    el.value = text;
    el.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [RegexTestPanel] });
    fixture = TestBed.createComponent(RegexTestPanel);
  });

  describe('mount gating', () => {
    it('renders nothing for a keyless entry', () => {
      bindEntry({});
      expect((fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.test-keys-header')).toBeNull();
    });

    it('renders nothing while the entry is constant — keys are ignored', () => {
      bindEntry({ keys: ['saber'], constant: true });
      expect((fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.test-keys-header')).toBeNull();
    });

    it('renders for a keyed, non-constant entry', () => {
      bindEntry({ keys: ['saber'] });
      expect(panelRoot().textContent).toContain('Test keys');
    });

    it('renders for a selective entry holding only secondary keys', () => {
      bindEntry({ secondary_keys: ['artoria'], selective: true });
      expect((fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.test-keys-header')).toBeTruthy();
    });
  });

  describe('collapse', () => {
    it('starts collapsed with the accordion ARIA and inert content', () => {
      bindEntry({ keys: ['saber'] });
      const toggle = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.test-keys-toggle');
      assert(toggle);

      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(anchorElement().id).toBe('regex-test-panel-0');
      expect(toggle.getAttribute('aria-controls')).toBe('regex-test-panel-0');
      expect(isInert(anchorElement())).toBe(true);
      // Conventional chevrons (NOT the accordion's inverted mapping):
      // collapsed points down.
      expect(toggle.textContent).toContain('expand_more');
      // Collapsed but mounted: the textarea exists behind the grid clip.
      expect(textareaElement()).toBeTruthy();
    });

    it('expands through the toggle and releases the content', () => {
      bindEntry({ keys: ['saber'] });
      toggleOpen();
      const toggle = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.test-keys-toggle');
      assert(toggle);

      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      expect(isInert(anchorElement())).toBe(false);
      expect(toggle.textContent).toContain('expand_less');
    });
  });

  describe('live matching', () => {
    it('shows a primary hit and flips with the case-sensitive option', () => {
      bindEntry({ keys: ['saber'] });
      toggleOpen();

      typeSample('Saber is the King of Knights');
      expect(matchRows()[0]?.textContent).toContain('Matches');
      expect(matchRows()[0]?.querySelector('.row-excerpt')).toBeTruthy();

      bindEntry({ keys: ['saber'], case_sensitive: true });
      expect(matchRows()[0]?.textContent).toContain('No match');
      expect(matchRows()[0]?.querySelector('.row-excerpt')).toBeNull();
    });

    it('shows a secondary hit with its logic label from ST_LOGIC_OPTIONS', () => {
      bindEntry({
        keys: ['servant'],
        secondary_keys: ['artoria'],
        selective: true,
        extensions: { selectiveLogic: 2 },
      });
      toggleOpen();
      typeSample('Artoria smiled');

      const rows = matchRows();
      expect(rows).toHaveLength(2);
      // Primary keys first, then secondary — list order.
      expect(rows[0]?.textContent).toContain('servant');
      expect(rows[0]?.textContent).toContain('No match');
      expect(rows[1]?.textContent).toContain('artoria');
      expect(rows[1]?.textContent).toContain('Matches');
      expect(rows[1]?.querySelector('.logic-chip')?.textContent?.trim()).toBe('NOT Any');
    });

    it('applies whole words to single-word keys but keeps substring for multi-word keys', () => {
      bindEntry({ keys: ['saber'] });
      toggleOpen();
      typeSample('Sabers everywhere');
      // Default (substring): 'saber' matches inside 'Sabers'.
      expect(matchRows()[0]?.textContent).toContain('Matches');

      bindEntry({ keys: ['saber'], extensions: { match_whole_words: true } });
      // Whole word: 'saber' inside 'Sabers' has a word character at its end.
      expect(matchRows()[0]?.textContent).toContain('No match');

      bindEntry({ keys: ['holy grail'], extensions: { match_whole_words: true } });
      typeSample('xholy graily');
      // Multi-word keys keep substring semantics even with whole words on.
      expect(matchRows()[0]?.textContent).toContain('Matches');
    });

    it('matches with a regex key and ignores the case and whole-word options', () => {
      bindEntry({
        keys: ['/(?:saber|artoria)/i'],
        case_sensitive: true,
        extensions: { match_whole_words: true },
      });
      toggleOpen();
      typeSample('ARTORIA rules');

      expect(matchRows()[0]?.textContent).toContain('Matches');
    });

    it('flags an invalid regex row and still shows the faithful plaintext fall-back', () => {
      bindEntry({ keys: ['/(saber/'] });
      toggleOpen();
      typeSample('nothing relevant here');

      const row = matchRows()[0];
      expect(row?.textContent).toContain('Invalid regex — treated as plain text');
      expect(row?.querySelector('.row-icon.invalid')).toBeTruthy();
      // The fall-through plaintext path finds nothing in a sane sample.
      expect(row?.querySelector('.row-excerpt')).toBeNull();

      typeSample('the raw key /(saber/ appears verbatim');
      // ...but the row still reports the faithful plaintext result when the
      // raw key string really does occur.
      expect(matchRows()[0]?.querySelector('.row-excerpt')).toBeTruthy();
    });

    it('reads every row as No match on an empty sample', () => {
      bindEntry({ keys: ['saber'], secondary_keys: ['artoria'], selective: true });
      toggleOpen();

      const rows = matchRows();
      expect(rows.length).toBe(2);
      for (const row of rows) {
        expect(row.textContent).toContain('No match');
        expect(row.querySelector('.row-excerpt')).toBeNull();
      }
      // No highlights without sample text.
      expect(fixture.nativeElement.querySelector('.preview')).toBeNull();
    });
  });

  describe('highlighted preview', () => {
    it('paints primary and secondary hits with their container tones', () => {
      bindEntry({ keys: ['saber'], secondary_keys: ['excalibur'], selective: true });
      toggleOpen();
      typeSample('Saber lifted Excalibur');

      const preview = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.preview');
      assert(preview);
      // aria-hidden: the textarea holds the accessible sample, the rows the facts.
      expect(preview.getAttribute('aria-hidden')).toBe('true');

      const primarySpans = [...preview.querySelectorAll<HTMLElement>('.tone-primary')];
      expect(primarySpans).toHaveLength(1);
      expect(primarySpans[0]?.textContent).toBe('Saber');
      const secondarySpans = [...preview.querySelectorAll<HTMLElement>('.tone-secondary')];
      expect(secondarySpans).toHaveLength(1);
      expect(secondarySpans[0]?.textContent).toBe('Excalibur');
    });

    it('shows the truncation note only beyond 200 matches', () => {
      bindEntry({ keys: ['saber'] });
      toggleOpen();
      typeSample('saber '.repeat(201));

      expect(fixture.nativeElement.textContent).toContain('Showing first 200 matches');

      typeSample('a single match only');
      expect(fixture.nativeElement.textContent).not.toContain('Showing first 200 matches');
    });
  });

  it('never collapses on Escape inside the textarea — collapse is the toggle alone', () => {
    bindEntry({ keys: ['saber'] });
    toggleOpen();

    textareaElement().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    fixture.detectChanges();

    const toggle = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.test-keys-toggle');
    assert(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(isInert(anchorElement())).toBe(false);
  });
});
