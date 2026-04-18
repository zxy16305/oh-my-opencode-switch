# Plugins

This directory contains OpenCode plugins. Plugins are loaded automatically by OpenCode when it starts.

## Available Plugins

### transform-keys

Production-ready plugin that converts `promptCacheKey` to `prompt_cache_key` for One-API compatibility.

**Problem:**

OpenCode sends `promptCacheKey` (camelCase), but One-API requires `prompt_cache_key` (snake_case). Without this plugin, prompt caching doesn't work with One-API.

**Solution:**

OpenCode decides which agents need prompt caching (e.g., title agent uses `small_model` and doesn't need caching). When OpenCode sets `promptCacheKey`, this plugin converts it to the snake_case format that One-API expects. Both fields may coexist in the request. One-API will use `prompt_cache_key` and ignore the unknown `promptCacheKey`.

**Behavior:**

- Checks `output.options.promptCacheKey` (set by OpenCode)
- If present, copies the value to `prompt_cache_key`
- If absent, does nothing (respects OpenCode's caching decision)
- No configuration needed - always active when installed

### test-minimal

Diagnostic test plugin used for validation during development. Not intended for production use.

## Commands

```bash
# List installed plugins
oos plugin list

# Install a plugin (copy from project plugins/ to user config)
oos plugin install transform-keys

# Uninstall a plugin
oos plugin uninstall transform-keys
```

## Verification

After installing `transform-keys`, verify it works by checking One-API logs:

1. Make a chat request through OpenCode (not a title generation request)
2. Check One-API logs for `prompt_cache_key` in the request body

You should see `prompt_cache_key` in outgoing requests when OpenCode has enabled caching for that agent type. Note: Some agents (like title generation using `small_model`) don't need caching, so `prompt_cache_key` won't appear in those requests.

## Troubleshooting

### Plugin not loading

**Symptom:** `prompt_cache_key` not appearing in requests.

**Solutions:**

1. Verify the plugin is installed:
   ```bash
   oos plugin list
   ```

2. Check the plugin file exists in `~/.config/opencode/plugin/`

3. Restart OpenCode to reload plugins

### promptCacheKey not present

**Symptom:** `prompt_cache_key` field is absent even with plugin installed.

**Cause:** OpenCode decides which agents need caching. For example, the title agent uses `small_model` and doesn't require caching, so `promptCacheKey` isn't set.

**Solution:** This is expected behavior. The plugin only converts what OpenCode provides.

### Both promptCacheKey and prompt_cache_key present

**Symptom:** Both fields appear in the request body.

**Cause:** OpenCode sets `promptCacheKey` while the plugin adds `prompt_cache_key`.

**Solution:** This is expected. One-API will use `prompt_cache_key` and ignore `promptCacheKey`.

## How Plugins Work

Plugins are ES modules that export a default async function returning a hooks object. These hooks are called by OpenCode at specific points during request processing:

```javascript
export default async function myPlugin() {
  return {
    'chat.params': async (input, output) => {
      // Modify output in place
    },
  };
}
```

Available hooks:

- `chat.params` - Called by OpenCode before sending request to the upstream API. Receives `input` (request context) and `output` (params to send).

## Disabling a Plugin

To disable a plugin, remove it from the plugins directory:

```bash
oos plugin uninstall transform-keys
# Or manually delete from ~/.config/opencode/plugin/
```
