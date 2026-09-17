import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { DiffViewer } from './diff-viewer';

describe('DiffViewer', () => {
  function create(
    props: {
      oldText: string;
      newText: string;
      mode?: 'unified' | 'split';
      interactive?: boolean;
    },
  ): ComponentFixture<DiffViewer> {
    const fixture = TestBed.createComponent(DiffViewer);
    fixture.componentRef.setInput('oldText', props.oldText);
    fixture.componentRef.setInput('newText', props.newText);
    if (props.mode) {
      fixture.componentRef.setInput('mode', props.mode);
    }
    if (props.interactive) {
      fixture.componentRef.setInput('interactive', true);
    }
    fixture.detectChanges();
    return fixture;
  }

  /** Sign characters of every rendered unified line, in order. */
  function unifiedSigns(fixture: ComponentFixture<DiffViewer>): string[] {
    return [...fixture.nativeElement.querySelectorAll('.diff-body .diff-line .sign')].map(
      (el) => el.textContent ?? '',
    );
  }

  function lines(fixture: ComponentFixture<DiffViewer>): HTMLElement[] {
    return [...fixture.nativeElement.querySelectorAll('.diff-body .diff-line')];
  }

  it('classifies added, removed and context lines with their signs', () => {
    const fixture = create({ oldText: 'Hello\nWorld', newText: 'Hello\nThere' });

    expect(unifiedSigns(fixture)).toEqual([' ', '−', '+']);
    const texts = lines(fixture).map((el) => el.querySelector('.text')?.textContent);
    expect(texts).toEqual(['Hello', 'World', 'There']);
    // The navigator parks on hunk 0, so the first change row is current.
    expect(lines(fixture).map((el) => el.className)).toEqual([
      'diff-line context',
      'diff-line removed hunk-current',
      'diff-line added',
    ]);
  });

  it('reports zero hunks and no navigator for identical texts', () => {
    const fixture = create({ oldText: 'Same\nText', newText: 'Same\nText' });

    expect(fixture.componentInstance['hunkCount']()).toBe(0);
    expect(fixture.nativeElement.querySelector('.hunk-nav')).toBeNull();
    expect(lines(fixture).length).toBe(2);
    expect(unifiedSigns(fixture)).toEqual([' ', ' ']);
  });

  it('counts a blank addition as one added line', () => {
    const fixture = create({ oldText: '', newText: 'Fresh start' });

    expect(fixture.componentInstance['stats']()).toEqual({ added: 1, removed: 0 });
    expect(unifiedSigns(fixture)).toEqual(['+']);
  });

  it('counts a blank removal as one removed line', () => {
    const fixture = create({ oldText: 'Gone forever', newText: '' });

    expect(fixture.componentInstance['stats']()).toEqual({ added: 0, removed: 1 });
    expect(unifiedSigns(fixture)).toEqual(['−']);
  });

  it('renders nothing for two empty texts', () => {
    const fixture = create({ oldText: '', newText: '' });

    expect(fixture.componentInstance['unifiedLines']()).toEqual([]);
    expect(fixture.componentInstance['hunkCount']()).toBe(0);
    expect(lines(fixture)).toHaveLength(0);
  });

  it('splits a multiline addition into padded side-by-side rows', () => {
    const fixture = create({
      oldText: 'start\nanchor\nend',
      newText: 'start\none\ntwo\nend',
      mode: 'split',
    });

    const rows = fixture.componentInstance['splitRows']();
    expect(rows).toHaveLength(4);
    // Context row shares the same line on both sides.
    expect(rows[0]).toEqual({
      left: { type: 'context', text: 'start' },
      right: { type: 'context', text: 'start' },
    });
    // The removed line pairs with the first added line; the surplus added
    // line pads the left side of the following row.
    expect(rows[1]).toEqual({
      left: { type: 'removed', text: 'anchor' },
      right: { type: 'added', text: 'one' },
    });
    expect(rows[2]?.left).toBeNull();
    expect(rows[2]?.right).toEqual({ type: 'added', text: 'two' });
  });

  it('renders split rows with empty-cell classes for the padding', () => {
    const fixture = create({
      oldText: 'start\nanchor\nend',
      newText: 'start\none\ntwo\nend',
      mode: 'split',
    });

    const rows = [...fixture.nativeElement.querySelectorAll('.split-row')];
    expect(rows).toHaveLength(4);
    // The surplus added line leaves the left cell empty.
    const padded = rows[1];
    assert(padded);
    expect(padded.children[0]?.className).toContain('removed');
    expect(padded.children[1]?.className).toContain('added');
    const padded2 = rows[2];
    assert(padded2);
    expect(padded2.children[0]?.className).toContain('empty');
    expect(padded2.children[1]?.className).toContain('added');
  });

  it('renders a paired split row for an even replacement', () => {
    const fixture = create({ oldText: 'old', newText: 'new', mode: 'split' });

    const rows = fixture.componentInstance['splitRows']();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.left).toEqual({ type: 'removed', text: 'old' });
    expect(rows[0]?.right).toEqual({ type: 'added', text: 'new' });
  });

  it('switches layouts through the interactive toggle', async () => {
    const fixture = create({
      oldText: 'old\nkeep',
      newText: 'new\nkeep',
      interactive: true,
    });
    expect(fixture.nativeElement.querySelector('.diff-body.unified')).toBeTruthy();

    const splitToggle = fixture.debugElement.query(
      By.css('.mode-toggle mat-button-toggle[value="split"]'),
    );
    splitToggle.nativeElement.querySelector('button').click();
    fixture.detectChanges();

    expect(fixture.componentInstance['viewMode']()).toBe('split');
    expect(fixture.nativeElement.querySelector('.diff-body.split')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.diff-body.unified')).toBeNull();

    const unifiedToggle = fixture.debugElement.query(
      By.css('.mode-toggle mat-button-toggle[value="unified"]'),
    );
    unifiedToggle.nativeElement.querySelector('button').click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.diff-body.unified')).toBeTruthy();
  });

  it('hides the mode switcher when not interactive', () => {
    const fixture = create({ oldText: 'a', newText: 'b', mode: 'split' });

    expect(fixture.nativeElement.querySelector('.mode-toggle')).toBeNull();
    // The static mode input still drives the layout.
    expect(fixture.nativeElement.querySelector('.diff-body.split')).toBeTruthy();
  });

  it('navigates hunks with wrap-around in both directions', async () => {
    const fixture = create({
      oldText: 'a1\nmid\na2',
      newText: 'b1\nmid\nb2',
    });
    const component = fixture.componentInstance;
    expect(component['hunkCount']()).toBe(2);
    expect(component['currentHunk']()).toBe(0);
    expect(fixture.nativeElement.querySelector('.hunk-counter')?.textContent).toContain('1 / 2');

    const buttons = [...fixture.nativeElement.querySelectorAll('.hunk-button')];
    assert(buttons[0]);
    buttons[0].click();
    fixture.detectChanges();
    // Previous from the first hunk wraps around to the last.
    expect(component['currentHunk']()).toBe(1);
    expect(fixture.nativeElement.querySelector('.hunk-counter')?.textContent).toContain('2 / 2');

    assert(buttons[1]);
    buttons[1].click();
    fixture.detectChanges();
    // Next from the last hunk wraps back to the first.
    expect(component['currentHunk']()).toBe(0);
  });

  it('marks the current hunk row and tags hunk starts in the DOM', async () => {
    const fixture = create({ oldText: 'a1\nmid\na2', newText: 'b1\nmid\nb2' });

    const hunked = [...fixture.nativeElement.querySelectorAll('[data-hunk]')];
    expect(hunked).toHaveLength(2);
    expect(hunked[0]?.className).toContain('hunk-current');

    fixture.componentInstance['goToHunk'](1);
    fixture.detectChanges();
    expect(hunked[0]?.className).not.toContain('hunk-current');
    expect(
      [...fixture.nativeElement.querySelectorAll('[data-hunk]')][1]?.className,
    ).toContain('hunk-current');
  });

  it('keeps the navigator parked on the first hunk after a diff change', async () => {
    const fixture = create({ oldText: 'a1\nmid\na2', newText: 'b1\nmid\nb2' });
    fixture.componentInstance['goToHunk'](1);
    expect(fixture.componentInstance['currentHunk']()).toBe(1);

    fixture.componentRef.setInput('oldText', 'x1\nmid\nx2');
    fixture.componentRef.setInput('newText', 'y1\nmid\ny2');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.componentInstance['currentHunk']()).toBe(0);
  });

  it('sums stats across multiple hunks', () => {
    const fixture = create({
      oldText: 'keep1\nold-a\nkeep2\nkeep3\nold-b\nkeep4',
      newText: 'keep1\nnew-a\nkeep2\nkeep3\nnew-b1\nnew-b2\nkeep4',
    });

    // Two change hunks: one replaced line, one line replaced by two.
    expect(fixture.componentInstance['stats']()).toEqual({ added: 3, removed: 2 });
    expect(fixture.componentInstance['hunkCount']()).toBe(2);
  });

  it('exposes the effective mode with the input as fallback', () => {
    const fixture = create({ oldText: 'a', newText: 'b', mode: 'split' });
    expect(fixture.componentInstance['effectiveMode']()).toBe('split');

    fixture.componentInstance['viewMode'].set('unified');
    expect(fixture.componentInstance['effectiveMode']()).toBe('unified');
  });
});
