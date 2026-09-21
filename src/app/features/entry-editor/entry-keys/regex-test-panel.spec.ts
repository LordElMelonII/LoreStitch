import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CharacterBookEntry, createEmptyEntry } from '../../../core/models/lorebook.model';
import type { StTriggerVerdict } from '../../../core/models/st-trigger';
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
    const el = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      '.test-keys-header',
    );
    assert(el);
    return el;
  }

  function anchorElement(): HTMLElement {
    const el = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      '.test-panel-anchor',
    );
    assert(el);
    return el;
  }

  function matchRows(): HTMLElement[] {
    return [...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.match-row')];
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

  /** Raw textContent keeps the template's source newlines; assertions read collapsed prose. */
  function textOf(el: HTMLElement | null): string {
    return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [RegexTestPanel] });
    fixture = TestBed.createComponent(RegexTestPanel);
  });

  describe('mount gating', () => {
    it('renders nothing for a keyless entry', () => {
      bindEntry({});
      expect(
        (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.test-keys-header'),
      ).toBeNull();
    });

    it('renders nothing while the entry is constant — keys are ignored', () => {
      bindEntry({ keys: ['saber'], constant: true });
      expect(
        (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.test-keys-header'),
      ).toBeNull();
    });

    it('renders for a keyed, non-constant entry', () => {
      bindEntry({ keys: ['saber'] });
      expect(panelRoot().textContent).toContain('Test keys');
    });

    it('renders for a selective entry holding only secondary keys', () => {
      bindEntry({ secondary_keys: ['artoria'], selective: true });
      expect(
        (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.test-keys-header'),
      ).toBeTruthy();
    });
  });

  describe('collapse', () => {
    it('starts collapsed with the accordion ARIA and inert content', () => {
      bindEntry({ keys: ['saber'] });
      const toggle = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
        '.test-keys-toggle',
      );
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
      const toggle = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
        '.test-keys-toggle',
      );
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

  describe('trigger verdict (Task 08 §3.2, checkpoint 08-1)', () => {
    function verdictElement(): HTMLElement | null {
      return (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.verdict');
    }

    function headlineText(): string {
      const headline = verdictElement()?.querySelector<HTMLElement>('.verdict-headline');
      assert(headline);
      return textOf(headline);
    }

    function hintElement(): HTMLElement {
      const hint = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('mat-hint');
      assert(hint);
      return hint;
    }

    it('lives inside the collapsible body — mounted while collapsed, inert until opened', () => {
      bindEntry({ keys: ['saber'] });
      expect(verdictElement()).toBeTruthy();
      expect(isInert(anchorElement())).toBe(true);

      toggleOpen();
      expect(isInert(anchorElement())).toBe(false);
      expect(verdictElement()).toBeTruthy();
    });

    it('states the approved inserted verdict when every gate passes', () => {
      bindEntry({ keys: ['saber'] });
      toggleOpen();
      typeSample('Saber is the King of Knights');

      const verdict = verdictElement();
      assert(verdict);
      expect(verdict.className).toContain('verdict-inserted');
      expect(verdict.querySelector('.verdict-icon')?.textContent?.trim()).toBe('check_circle');
      expect(headlineText()).toBe('Would be inserted into SillyTavern’s context for this sample.');
      // The good news carries no negation emphasis.
      expect(verdict.querySelector('.verdict-headline strong')).toBeNull();
    });

    it('states the approved blocked verdict with the entry’s actual logic label (the report repro)', () => {
      bindEntry({
        keys: ['servant'],
        secondary_keys: ['avalon'],
        selective: true,
        extensions: { selectiveLogic: 2 }, // NOT Any
      });
      toggleOpen();
      typeSample('Servant with avalon');

      const verdict = verdictElement();
      assert(verdict);
      expect(verdict.className).toContain('verdict-blocked');
      expect(verdict.querySelector('.verdict-icon')?.textContent?.trim()).toBe('block');
      expect(headlineText()).toBe(
        'Would not be inserted — the matched “NOT Any” secondary keys block activation.',
      );
      expect(verdict.querySelector('.verdict-headline strong')?.textContent).toBe('not');
    });

    it('keeps the blocked copy parallel for the other secondary logics', () => {
      // AND Any denied: no secondary key matched.
      bindEntry({
        keys: ['servant'],
        secondary_keys: ['avalon'],
        selective: true,
        extensions: { selectiveLogic: 0 },
      });
      toggleOpen();
      typeSample('Servant rides out');
      expect(headlineText()).toBe(
        'Would not be inserted — no “AND Any” secondary key matches this sample.',
      );

      // AND All denied: some secondary key did not match.
      bindEntry({
        keys: ['servant'],
        secondary_keys: ['avalon', 'camelot'],
        selective: true,
        extensions: { selectiveLogic: 3 },
      });
      typeSample('Servant with avalon'); // camelot stays silent
      expect(headlineText()).toBe(
        'Would not be inserted — not every “AND All” secondary key matches this sample.',
      );

      // NOT All denied: every secondary key matched.
      bindEntry({
        keys: ['servant'],
        secondary_keys: ['avalon'],
        selective: true,
        extensions: { selectiveLogic: 1 },
      });
      typeSample('Servant with avalon');
      expect(headlineText()).toBe(
        'Would not be inserted — the matched “NOT All” secondary keys block activation.',
      );
    });

    it('falls back to a generic cause when a vendor writes an out-of-enum logic value', () => {
      bindEntry({
        keys: ['servant'],
        secondary_keys: ['avalon'],
        selective: true,
        extensions: { selectiveLogic: 99 }, // satisfies no gate branch — ST denies
      });
      toggleOpen();
      typeSample('Servant with avalon');

      expect(verdictElement()?.className).toContain('verdict-blocked');
      expect(headlineText()).toBe(
        'Would not be inserted — the entry’s secondary-key logic denies activation.',
      );
      // No matched row claims to block — the gate denied on unknown logic.
      for (const row of matchRows()) {
        expect(row.querySelector('.blocks-suffix')).toBeNull();
      }
    });

    it('states the probabilistic verdict with the imported roll percentage', () => {
      bindEntry({ keys: ['saber'], extensions: { probability: 60, useProbability: true } });
      toggleOpen();
      typeSample('Saber is the King of Knights');

      const verdict = verdictElement();
      assert(verdict);
      expect(verdict.className).toContain('verdict-probabilistic');
      expect(verdict.querySelector('.verdict-icon')?.textContent?.trim()).toBe('casino');
      expect(headlineText()).toBe(
        'Fires a probability roll in SillyTavern — inserted 60% of the time.',
      );
    });

    it('states the inconclusive verdict for a vectorized entry whose keys stayed silent', () => {
      bindEntry({ keys: ['saber'], extensions: { vectorized: true } });
      toggleOpen();
      typeSample('nothing relevant here');

      const verdict = verdictElement();
      assert(verdict);
      expect(verdict.className).toContain('verdict-inconclusive');
      expect(verdict.querySelector('.verdict-icon')?.textContent?.trim()).toBe('blur_on');
      expect(headlineText()).toBe(
        'Keys stayed silent — Vector Storage may still insert this by similarity.',
      );
      const sub = verdict.querySelector<HTMLElement>('.verdict-sub');
      assert(sub);
      expect(textOf(sub)).toBe('Similarity is not testable here.');
    });

    it('stays honest about blocked entries: disabled and keyless', () => {
      bindEntry({ keys: ['saber'], enabled: false });
      toggleOpen();
      typeSample('Saber rules');
      expect(verdictElement()?.className).toContain('verdict-blocked');
      expect(headlineText()).toBe('Would not be inserted — the entry is disabled.');

      // A selective entry holding only secondary keys has no primary scan at
      // all — the panel still opens, and the verdict says why it blocks.
      bindEntry({ secondary_keys: ['avalon'], selective: true });
      typeSample('avalon shines');
      expect(headlineText()).toBe(
        'Would not be inserted — the entry has no primary keys, so the keyword scan skips it.',
      );
    });

    it('flips the verdict as the sample text changes', () => {
      bindEntry({ keys: ['saber'], extensions: { probability: 60, useProbability: true } });
      toggleOpen();
      typeSample('nothing relevant here');
      expect(verdictElement()?.className).toContain('verdict-blocked');
      expect(headlineText()).toBe('Would not be inserted — no primary key matches this sample.');

      typeSample('Saber arrives');
      expect(verdictElement()?.className).toContain('verdict-probabilistic');
      expect(headlineText()).toBe(
        'Fires a probability roll in SillyTavern — inserted 60% of the time.',
      );
    });

    it('marks the matched secondary row as blocking under NOT Any (treatment 1)', () => {
      bindEntry({
        keys: ['servant'],
        secondary_keys: ['avalon'],
        selective: true,
        extensions: { selectiveLogic: 2 },
      });
      toggleOpen();
      typeSample('Servant with avalon');

      const rows = matchRows();
      expect(rows).toHaveLength(2);
      // The suffix lives on the offending row's state word, after "Matches".
      expect(textOf(rows[1]?.querySelector('.row-state') ?? null)).toBe(
        'Matches (blocks activation)',
      );
      const suffix = rows[1]?.querySelector<HTMLElement>('.blocks-suffix');
      assert(suffix);
      expect(textOf(suffix)).toBe('(blocks activation)');
      // The matched PRIMARY row never reads as blocking.
      expect(rows[0]?.querySelector('.blocks-suffix')).toBeNull();
    });

    it('leaves matched secondary rows alone under AND Any — the entry is simply inserted', () => {
      bindEntry({
        keys: ['servant'],
        secondary_keys: ['avalon'],
        selective: true,
        extensions: { selectiveLogic: 0 },
      });
      toggleOpen();
      typeSample('Servant with avalon');

      expect(verdictElement()?.className).toContain('verdict-inserted');
      for (const row of matchRows()) {
        expect(row.querySelector('.blocks-suffix')).toBeNull();
      }
    });

    it('does not blame matched secondaries under AND All — the missing one blocks', () => {
      bindEntry({
        keys: ['servant'],
        secondary_keys: ['avalon', 'camelot'],
        selective: true,
        extensions: { selectiveLogic: 3 },
      });
      toggleOpen();
      typeSample('Servant with avalon');

      expect(verdictElement()?.className).toContain('verdict-blocked');
      for (const row of matchRows()) {
        expect(row.querySelector('.blocks-suffix')).toBeNull();
      }
    });

    it('lists the live-outcome overrides in the hint', () => {
      bindEntry({ keys: ['saber'] });
      toggleOpen();

      const text = textOf(hintElement());
      expect(text).toContain(
        'Probability rolls, sticky/cooldown timers, the inclusion-group budget, recursion, and Vector Storage for vectorized entries',
      );
      expect(text).toContain('change the live outcome');
    });

    it('renders copy for every machine reason — the reason @switch is exhaustively guarded', () => {
      // Angular's `@switch` does no compile-time exhaustiveness checking: a
      // future member of StTriggerVerdict['reason'] would otherwise compile
      // clean and silently render an empty banner. This typed record is the
      // guard — it fails THIS file's typecheck the moment the union grows
      // without a fixture, and the loop below fails when the matching
      // `@case` copy or the outlook icon is missing from the template. The
      // fixtures double as coverage of every outlook of the icon `@switch`.
      const reasonFixtures: Readonly<
        Record<StTriggerVerdict['reason'], { entry: Partial<CharacterBookEntry>; sample: string }>
      > = {
        disabled: { entry: { keys: ['saber'], enabled: false }, sample: 'Saber rules' },
        'no-keys': {
          entry: { secondary_keys: ['avalon'], selective: true },
          sample: 'avalon shines',
        },
        'no-key-matched': { entry: { keys: ['saber'] }, sample: 'nothing relevant here' },
        'secondary-logic-denied': {
          entry: {
            keys: ['servant'],
            secondary_keys: ['avalon'],
            selective: true,
            extensions: { selectiveLogic: 2 }, // NOT Any
          },
          sample: 'Servant with avalon',
        },
        always: { entry: { keys: ['saber'] }, sample: 'Saber is the King of Knights' },
        'probability-roll': {
          entry: { keys: ['saber'], extensions: { probability: 60, useProbability: true } },
          sample: 'Saber is the King of Knights',
        },
        'vector-similarity-only': {
          entry: { keys: ['saber'], extensions: { vectorized: true } },
          sample: 'nothing relevant here',
        },
      };

      bindEntry({ keys: ['saber'] });
      toggleOpen(); // the open signal survives re-binds; open once for realism
      for (const [reason, reasonCase] of Object.entries(reasonFixtures)) {
        bindEntry(reasonCase.entry);
        typeSample(reasonCase.sample);
        const headline = verdictElement()?.querySelector<HTMLElement>('.verdict-headline');
        assert(headline, `reason "${reason}" renders no headline`);
        expect(textOf(headline), `reason "${reason}" renders an empty headline`).not.toBe('');
        const icon = verdictElement()?.querySelector<HTMLElement>('.verdict-icon');
        assert(icon, `outlook of reason "${reason}" renders no icon`);
      }
    });
  });

  it('never collapses on Escape inside the textarea — collapse is the toggle alone', () => {
    bindEntry({ keys: ['saber'] });
    toggleOpen();

    textareaElement().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();

    const toggle = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      '.test-keys-toggle',
    );
    assert(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(isInert(anchorElement())).toBe(false);
  });
});
