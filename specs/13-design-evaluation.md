# 13 — Design Evaluation

## Overview

Design evaluation captures screenshots of the running application and provides them to the AI assistant for visual review. It automates the tedious cycle of "build → open browser → screenshot → send to AI → get feedback → repeat" into a single command that captures full-page, multi-viewport screenshots of detected routes.

## Capabilities

### Dev Server Detection

The system must:

1. Probe common development server ports to find a running server.
2. If no server is running: detect the project's dev server start command from project metadata and optionally start it.
3. Wait for the server to become responsive before capturing.

### Route Detection

The system must:

1. Scan the project for route definitions using common conventions:
   - File-system-based routing: directory structures where file paths map to URLs.
   - Explicit route configuration files.
2. Allow the user to override detected routes with explicit `--routes` or `--url` flags.

### Screenshot Capture

For each route, the system must:

1. Navigate to the route in a headless browser.
2. Wait for the page to be visually stable (network idle, no pending animations).
3. Capture the full page as sectioned viewport-height images:
   - Divide the page into sections equal to the viewport height.
   - Maximum configurable sections per page (default: 8).
   - Each section is a separate image file.
4. Capture at two viewports by default:
   - Desktop: 1440×900.
   - Mobile: 375×812.
   - `--desktop-only` flag to skip mobile.
5. Save images as compressed format (quality configurable, default: 70).
6. Name files systematically: `{route}-{viewport}-{section}.{ext}`.

### Output

- Save all captures to a dedicated subdirectory within the state directory.
- Generate a metadata report file listing: route, viewport, section count, file sizes, timestamps.
- The AI assistant can then read the captured images and provide visual feedback.

### Feedback Workflow

After capture, the AI assistant should:

1. Read each captured image.
2. Evaluate against design criteria: spacing, typography, color consistency, accessibility, layout responsiveness, visual hierarchy.
3. Provide inline feedback with specific, actionable items.
4. The user can request fixes, after which re-capture verifies the changes.

## Acceptance Criteria

```
GIVEN a dev server is running on port 3000
WHEN "mink designqc" is run
THEN the system detects the server on port 3000
AND captures screenshots of detected routes
AND saves images to the captures subdirectory
AND generates a metadata report

GIVEN the project has 3 routes: /, /about, /contact
WHEN design evaluation captures all routes
THEN each route has desktop and mobile captures
AND long pages are divided into viewport-height sections

GIVEN a route renders a page 2700px tall on a 900px viewport
WHEN the page is captured
THEN 3 section images are produced (3 × 900 = 2700)

GIVEN "mink designqc --url http://localhost:3000/dashboard --desktop-only" is run
WHEN the capture completes
THEN only desktop viewport screenshots are taken
AND only the /dashboard route is captured

GIVEN captures exist in the state directory
WHEN the AI assistant reads the images
THEN it can provide feedback on spacing, typography, color, and layout

GIVEN "mink designqc --quality 50" is run
WHEN images are saved
THEN they use quality level 50 compression
```

## Edge Cases

- No dev server running and project metadata lacks a start command — inform user, exit with clear error.
- Route returns an error page (404, 500) — still capture it, note the error status in metadata.
- Route requires authentication — capture the auth redirect/login page, note it in metadata.
- Page has infinite scroll or lazy-loaded content — capture only the initially loaded content up to max sections.
- Headless browser is not installed — provide clear installation instructions in error message.
- Dev server takes more than 30 seconds to start — timeout with informative error.

## Test Requirements

- Unit: Port probing logic detects running servers.
- Unit: Route detection from sample directory structures.
- Unit: Section calculation (page height / viewport height, capped at max sections).
- Unit: File naming convention produces correct paths.
- Integration: Full capture workflow on a sample project with known routes.
- Edge: No server running produces clear error.
- Edge: Missing headless browser produces clear installation instructions.
- Edge: Error page routes are captured with error metadata.
