# webos-devtools-mcp

A page-scoped MCP server for Chrome DevTools Protocol automation. Works with any
page-scoped websocket endpoint, but built for use with WebOS in particular.

## Background

This MCP server connects directly to a Chrome DevTools **page** WebSocket endpoint, unlike [chrome-devtools-mcp](https://github.com/chrishayuk/chrome-devtools-mcp) which requires a browser-targeted endpoint.

This distinction matters when debugging environments that only expose page-level sockets, such as:
- WebOS applications
- Embedded Chromium instances
- Remote debugging scenarios with limited access

## Installation

```bash
pnpm install
pnpm build
```

## Usage

The server requires a page WebSocket endpoint. You can provide it via:

**Command-line flag:**
```bash
node ./dist/index.js --endpoint ws://localhost:9222/devtools/page/ABC123...
```

**Environment variable:**
```bash
PAGE_WS_ENDPOINT=ws://localhost:9222/devtools/page/ABC123... node ./dist/index.js
```

### MCP Configuration

Add to your MCP settings file (e.g., `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "chrome-page-devtools": {
      "command": "node",
      "args": [
        "/path/to/webos-devtools-mcp/dist/index.js",
        "--endpoint",
        "ws://localhost:9222/devtools/page/YOUR_PAGE_ID"
      ]
    }
  }
}
```

## Available Tools

### JavaScript Evaluation
- `evaluate_expression` - Execute JavaScript in the page context

### DOM Inspection
- `dom_query_selector` - Query and inspect elements by CSS selector
- `dom_get_outer_html` - Retrieve the full HTML of an element
- `dom_accessibility_tree` - Dump the accessibility tree
- `dom_list_event_listeners` - List DOM event listeners attached to an element, document, or window

### DOM Interaction
- `dom_click` - Click an element
- `dom_type_text` - Type text into inputs/textareas

### Navigation
- `page_navigate` - Navigate to a URL
- `page_reload` - Reload the current page

### Storage
- `storage_list_cookies` - List cookies
- `storage_set_cookie` - Create or update a cookie
- `storage_delete_cookie` - Delete a specific cookie
- `storage_clear_cookies` - Clear all cookies
- `storage_list_local_storage` - List localStorage entries
- `storage_set_local_storage` - Set a localStorage item
- `storage_remove_local_storage` - Remove a localStorage item

### Network Capture
- `network_start_capture` - Begin capturing network requests
- `network_stop_capture` - Stop capturing network requests
- `network_clear_capture` - Clear captured requests
- `network_list_requests` - List captured requests with filtering (method, resource type, failed only)
- `network_get_request_body` - Retrieve request or response body for a specific request

### Remote Control Keys (WebOS/TV)
- `remote_press_key` - Dispatch remote control keys (arrows, OK, back, colored buttons, media controls, etc.)
- `remote_type_text` - Send text via character key events

### Debugging
- `list_logs` - Retrieve buffered console messages, exceptions, and logs
- `clear_logs` - Clear the log buffer
- `take_screenshot` - Capture a screenshot

### Console Streaming
- `console_subscribe` - Begin streaming console output in real time
- `console_unsubscribe` - Stop streaming console output
- `console_stream_status` - Report current console streaming status

### Visual Overlays
- `overlay_highlight` - Highlight an element matching a selector
- `overlay_highlight_focused` - Highlight the currently focused element (document.activeElement)
- `overlay_hide` - Hide any active overlay highlight immediately
