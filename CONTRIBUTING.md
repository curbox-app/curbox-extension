# Contributing to Curbox Browser Extension

First off, thank you for considering contributing to Curbox! It's people like you that make Curbox such a great tool.

## How to Contribute

We welcome contributions in various forms, including:
- Reporting bugs
- Suggesting enhancements
- Submitting pull requests for new features or bug fixes
- Improving documentation

## Getting Started

1.  **Fork & Clone**: Fork the repository and clone it to your local machine.
2.  **Install Dependencies**: We use `bun` for package management.
    ```bash
    bun install
    ```
3.  **Run in Development**: To start the development server and load the extension in your browser:
    ```bash
    bun dev
    ```
    This will create a `dist` directory with the unpacked extension. Follow the instructions in your browser to load it.

## Architecture

The extension follows a compartmentalized architecture:

1.  **Background Service Worker (Core Logic)**:
    -   **Usage Tracker Component**: Monitors active tab time and tab changes.
    -   **Blocker Component**: Evaluates if a URL should be blocked.
    -   **Focus Mode Component**: Manages focus sessions.
    -   State is persisted to `chrome.storage.local`.

2.  **Content Scripts (Enforcement & Tracking)**:
    -   **Visibility Tracker**: Uses the Page Visibility API to track time accurately.
    -   **Overlay Injector**: Injects the block overlay into the DOM.

3.  **Popup / Dashboard UI**:
    -   Built with React and Tailwind CSS.
    -   Displays usage stats and provides configuration options.

## Code Style

-   **DRY Principle**: Don't repeat yourself.
-   **Comments**: Only use comments where the code's purpose is not immediately obvious.
-   **TypeScript**: Follow standard TypeScript best practices.

## UX Principles

-   **Speak in First Person**: "I'm helping you stay focused" instead of "Focus mode is active."
-   **No Dashes**: Never use dashes (-) in user-facing text.
-   **Simple Language**: Keep it simple, crisp, and concise (aim for a 6th-grade reading level).
-   **Peaceful Friction**: The goal is to provide a "pause" for the user, not a "punishment."

## Submitting a Pull Request

1.  Create a new branch for your feature or bugfix.
2.  Make your changes, adhering to the code style and UX principles.
3.  Ensure your code is well-formatted and lint-free.
4.  Submit a pull request with a clear description of the changes you've made.

Thank you for your contribution!
