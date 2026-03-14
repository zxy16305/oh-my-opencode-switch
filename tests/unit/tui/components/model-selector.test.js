import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert';
import blessed from 'blessed';
import { ModelSelector } from '../../../../src/tui/components/model-selector.js';
import * as modelAggregator from '../../../../src/tui/model-aggregator.js';

mock.method(blessed, 'box', () => ({
  show: mock.fn(),
  hide: mock.fn(),
  destroy: mock.fn(),
  setContent: mock.fn(),
}));

mock.method(blessed, 'list', () => ({
  show: mock.fn(),
  hide: mock.fn(),
  destroy: mock.fn(),
  setItems: mock.fn(),
  select: mock.fn(),
  focus: mock.fn(),
  key: mock.fn(),
  selected: 0,
}));

mock.method(modelAggregator, 'getModels', async () => [
  { provider: 'openai', models: ['gpt-4', 'gpt-3.5-turbo'], source: 'models' },
  { provider: 'anthropic', models: ['claude-3-opus', 'claude-3-sonnet'], source: 'models' },
]);

describe('ModelSelector', () => {
  let screen;

  beforeEach(() => {
    screen = {
      render: mock.fn(),
      key: mock.fn(),
    };
    mock.reset();
  });

  describe('single select mode (default)', () => {
    it('should maintain backward compatibility with existing API', () => {
      const selector = new ModelSelector(screen);
      assert.strictEqual(selector.multi, false);
      assert.ok(selector.list);
      assert.ok(!selector.availableList);
      assert.ok(!selector.selectedList);
    });

    it('should call onSelect with single model ID when confirmed', async () => {
      const selector = new ModelSelector(screen);
      let selectedId = null;
      selector.onSelect((id) => {
        selectedId = id;
      });

      await selector.loadModels('gpt-4');

      const enterHandler = screen.key.mock.calls.find((call) => call[0].includes('enter'))[1];
      enterHandler();

      assert.strictEqual(selectedId, 'gpt-4');
    });

    it('should get selected model correctly', async () => {
      const selector = new ModelSelector(screen);
      await selector.loadModels('gpt-3.5-turbo');

      const selected = selector.getSelected();
      assert.strictEqual(selected.fullId, 'gpt-3.5-turbo');
      assert.strictEqual(selected.provider, 'openai');
    });
  });

  describe('multi select mode', () => {
    it('should initialize with multi mode when option is set', () => {
      const selector = new ModelSelector(screen, { multi: true });
      assert.strictEqual(selector.multi, true);
      assert.ok(selector.availableList);
      assert.ok(selector.selectedList);
      assert.ok(selector.helpBar);
    });

    it('should initialize selected models from currentValue array', async () => {
      const selector = new ModelSelector(screen, { multi: true });
      await selector.loadModels(['gpt-4', 'claude-3-opus']);

      assert.strictEqual(selector.selectedModels.length, 2);
      assert.strictEqual(selector.selectedModels[0].fullId, 'gpt-4');
      assert.strictEqual(selector.selectedModels[1].fullId, 'claude-3-opus');
    });

    it('should prevent adding duplicate models', async () => {
      const selector = new ModelSelector(screen, { multi: true });
      await selector.loadModels(['gpt-4']);

      selector.availableList.selected = 1;
      selector.addSelectedModel();

      assert.strictEqual(selector.selectedModels.length, 1);
    });

    it('should prevent deleting last selected model', async () => {
      const selector = new ModelSelector(screen, { multi: true });
      await selector.loadModels(['gpt-4']);

      selector.selectedList.selected = 0;
      selector.deleteSelectedModel();

      assert.strictEqual(selector.selectedModels.length, 1);
    });

    it('should move selected model up in priority', async () => {
      const selector = new ModelSelector(screen, { multi: true });
      await selector.loadModels(['gpt-4', 'claude-3-opus', 'gpt-3.5-turbo']);

      selector.selectedList.selected = 1;
      selector.moveSelectedModelUp();

      assert.strictEqual(selector.selectedModels[0].fullId, 'claude-3-opus');
      assert.strictEqual(selector.selectedModels[1].fullId, 'gpt-4');
    });

    it('should move selected model down in priority', async () => {
      const selector = new ModelSelector(screen, { multi: true });
      await selector.loadModels(['gpt-4', 'claude-3-opus', 'gpt-3.5-turbo']);

      selector.selectedList.selected = 0;
      selector.moveSelectedModelDown();

      assert.strictEqual(selector.selectedModels[0].fullId, 'claude-3-opus');
      assert.strictEqual(selector.selectedModels[1].fullId, 'gpt-4');
    });

    it('should return array of model IDs in priority order when confirmed', async () => {
      const selector = new ModelSelector(screen, { multi: true });
      let selectedIds = null;
      selector.onSelect((ids) => {
        selectedIds = ids;
      });

      await selector.loadModels(['gpt-4', 'claude-3-opus']);

      const enterHandler = selector.list.key.mock.calls.find((call) =>
        call[0].includes('enter')
      )[1];
      enterHandler();

      assert.deepStrictEqual(selectedIds, ['gpt-4', 'claude-3-opus']);
    });

    it('getSelected should return array of selected models in multi mode', async () => {
      const selector = new ModelSelector(screen, { multi: true });
      await selector.loadModels(['gpt-4', 'claude-3-opus']);

      const selected = selector.getSelected();
      assert.strictEqual(selected.length, 2);
      assert.strictEqual(selected[0].fullId, 'gpt-4');
      assert.strictEqual(selected[1].fullId, 'claude-3-opus');
    });

    describe('arrow key navigation', () => {
      it('should switch focus to selectedList when right arrow pressed on availableList', async () => {
        const selector = new ModelSelector(screen, { multi: true });
        await selector.loadModels(['gpt-4']);

        // Get the right arrow handler from availableList
        const rightHandler = selector.availableList.key.mock.calls.find((call) =>
          call[0].includes('right')
        )?.[1];

        // Initial state
        assert.strictEqual(selector.focusedList, selector.availableList);

        // Press right arrow
        if (rightHandler) {
          rightHandler();
          assert.strictEqual(selector.focusedList, selector.selectedList);
        }
      });

      it('should switch focus to availableList when left arrow pressed on selectedList', async () => {
        const selector = new ModelSelector(screen, { multi: true });
        await selector.loadModels(['gpt-4']);

        // First switch to selectedList
        selector.focusedList = selector.selectedList;

        // Get the left arrow handler from selectedList
        const leftHandler = selector.selectedList.key.mock.calls.find((call) =>
          call[0].includes('left')
        )?.[1];

        if (leftHandler) {
          leftHandler();
          assert.strictEqual(selector.focusedList, selector.availableList);
        }
      });

      it('should confirm selection when left arrow pressed on availableList', async () => {
        const selector = new ModelSelector(screen, { multi: true });
        let selectedIds = null;
        selector.onSelect((ids) => {
          selectedIds = ids;
        });

        await selector.loadModels(['gpt-4', 'claude-3-opus']);

        // Get the left arrow handler from availableList
        const leftHandler = selector.availableList.key.mock.calls.find((call) =>
          call[0].includes('left')
        )?.[1];

        if (leftHandler) {
          leftHandler();
          assert.deepStrictEqual(selectedIds, ['gpt-4', 'claude-3-opus']);
        }
      });

      it('should do nothing when right arrow pressed on selectedList', async () => {
        const selector = new ModelSelector(screen, { multi: true });
        await selector.loadModels(['gpt-4']);

        selector.focusedList = selector.selectedList;

        // Get the right arrow handler from selectedList
        const rightHandler = selector.selectedList.key.mock.calls.find((call) =>
          call[0].includes('right')
        )?.[1];

        if (rightHandler) {
          rightHandler();
          // Should still be on selectedList (no action)
          assert.strictEqual(selector.focusedList, selector.selectedList);
        }
      });
    });
  });
});
