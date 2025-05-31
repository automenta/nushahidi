# NostrMapper

## Overview

NostrMapper is a Progressive Web Application (PWA) designed for decentralized geographic reporting built on the Nostr protocol. Its primary purpose is to enable users to create, share, and discover geo-tagged events and observations directly on a map, leveraging Nostr's censorship-resistant and open communication network. It aims to provide a user-friendly interface for interacting with location-based Nostr events, making it easy to report incidents, share observations, or highlight points of interest within a community.

## Features

NostrMapper offers a comprehensive set of features for interacting with geo-tagged Nostr events:

### Nostr Integration
*   **Identity Management**: Supports NIP-07 browser extensions (e.g., Alby, nos2x) for secure key handling. Also provides local private key generation and import, with passphrase encryption for storage in IndexedDB.
*   **Event Publishing**: Publishes various Nostr event kinds, including custom geo-tagged reports (Kind 30315), reactions (Kind 7), comments (Kind 1), and NIP-02 contact lists (Kind 3).
*   **Event Deletion**: Supports NIP-09 for deleting previously published events.
*   **Relay Management**: Users can add, remove, and manage their preferred Nostr relays, with real-time connection status and NIP-11 relay information display.
*   **Profile Fetching**: Fetches and caches Nostr profiles (Kind 0) for displaying author information.
*   **Contact List (NIP-02)**: Import contacts from relays and publish your followed list as a NIP-02 event.

### Reporting
*   **Geo-tagged Reports**: Create detailed reports linked to specific geographic coordinates.
*   **Rich Content**: Reports include title, summary, and a Markdown-enabled description.
*   **Categorization & Tags**: Assign predefined categories (e.g., Incident, Observation, Aid) and add custom free-form tags.
*   **Event Type & Status**: Define the type of event (e.g., Observation, Incident) and its status (e.g., New, Active).
*   **Image Uploads**: Attach multiple images to reports, with support for Nostr.build (default) and custom NIP-96 image hosts. Includes client-side image processing (dimensions, hash).

### Mapping & Location
*   **Interactive Map**: Powered by Leaflet.js, displaying reports as clustered markers.
*   **Custom Tile Servers**: Users can select from predefined map tile presets or add custom tile server URLs.
*   **Location Picking**: Pick locations directly from the map, use device GPS, or geocode an address.
*   **Spatial Filtering**: Draw polygons, rectangles, or circles on the map to filter reports within the drawn area.
*   **Geohash Integration**: Utilizes geohashes for efficient spatial indexing and filtering of reports.

### Filtering & Discovery
*   **Comprehensive Filters**: Filter reports by search query (title, summary, content), category, author (pubkey), and time range.
*   **Focus Tags**: Filter reports by a specific "focus tag" (e.g., #MyEvent), allowing users to scope their view to relevant communities or events.
*   **Followed Users Filter**: Option to display reports only from users you follow.
*   **Mute List**: Mute specific pubkeys to hide their reports from your view.

### Offline & Data Management
*   **Progressive Web App (PWA)**: Installable and works offline.
*   **Offline Queue**: Events published while offline are queued in IndexedDB and automatically synced when an internet connection is restored via Workbox Background Sync.
*   **Local Data Storage**: Reports, profiles, settings, and drawn shapes are cached locally in IndexedDB for fast access and offline availability.
*   **Database Pruning**: Automatically prunes old reports and profiles to manage local storage.
*   **Settings Export/Import**: Export current settings and followed users to a JSON file, and import settings from a file.
*   **Clear Cached Data**: Option to clear all cached reports from the local database.

### User Experience
*   **Toasts**: Provides non-intrusive, dismissible toast notifications for user feedback (success, error, info, warning).
*   **Loading Indicators**: Global and per-action loading spinners to indicate ongoing processes.
*   **Modals**: Utilizes dynamic modals for forms (report creation, settings, authentication), confirmations, and passphrase entry.

## Design Description

NostrMapper follows a client-side, service-oriented architecture, emphasizing modularity, maintainability, and a responsive user experience.

### Core Architecture
The application is structured as a Single-Page Application (SPA) with a clear separation of concerns:

*   **State Management (`src/store.js`)**: A simple, custom-built global store (`appStore`) manages the application's state. It provides `get`, `set`, and `on` methods for reactive updates, ensuring that UI components automatically re-render when relevant state changes.
*   **Services (`src/services/`)**: This directory contains all business logic and interactions with external APIs or browser features (IndexedDB, Nostr relays, geolocation, image uploads). Each service is responsible for a specific domain (e.g., `dbSvc` for IndexedDB, `nostrSvc` for Nostr communication, `mapSvc` for map interactions).
*   **UI Components (`src/ui/`)**: These modules are responsible for rendering the user interface and handling user interactions. They read from the `appStore` and call methods on the services to perform actions.
*   **Utilities (`src/utils.js`)**: A collection of common helper functions, including DOM manipulation (`$`, `createEl`), HTML sanitization, cryptographic operations (encryption/decryption for local keys), Nostr-specific helpers (npub/nsec conversion, event parsing), geohash utilities, and toast notifications.
*   **Decorators (`src/decorators.js`)**: Higher-order functions that wrap service methods or UI handlers to add cross-cutting concerns like loading state management (`withLoading`) and automatic toast notifications (`withToast`).

### Data Flow
1.  **Initialization**: On load, `src/main.js` initializes services (config, identity, map) and the UI. It loads settings and cached reports from IndexedDB into the `appStore`.
2.  **User Interaction**: UI components capture user input (e.g., form submission, button clicks).
3.  **Service Calls**: UI components call relevant methods on services (e.g., `nostrSvc.pubEv`, `confSvc.save`).
4.  **State Updates**: Services perform their logic (e.g., interact with IndexedDB, Nostr relays, external APIs). Upon completion, they update the `appStore`.
5.  **UI Re-render**: Due to the reactive nature of `appStore`, UI components listening to specific state changes automatically re-render to reflect the new data.

### Data Persistence
*   **IndexedDB (`src/services/db.js`)**: All persistent application data (reports, user settings, profiles, offline queue, drawn shapes, followed pubkeys) is stored client-side using IndexedDB. This ensures data availability even offline and reduces reliance on external servers for basic functionality.
*   **Service Worker (`sw.js`, `workbox-config.cjs`)**: Utilizes Workbox for robust offline capabilities. It precaches essential assets and implements a Background Sync queue for Nostr event publishing, ensuring that events are eventually sent even if the user is offline at the time of creation.

### Build and Development
*   **Vite**: Used as the build tool for fast development and optimized production builds.
*   **Workbox CLI**: Integrates with Vite's build process to generate the Service Worker, handling precaching and runtime caching strategies.

## User Interface (UI) Description

The NostrMapper UI is designed for clarity and ease of use, providing a single-page experience with a prominent map and an interactive sidebar.

### Overall Layout
*   **Header**: Located at the top, it displays the application title, real-time connection and sync status indicators, and user authentication controls (Connect Nostr/Logout, user pubkey snippet).
*   **Main Content Area**: Divided into two primary sections:
    *   **Map Container (`#map-container`)**: The central and largest part of the screen, displaying the interactive map with report markers.
    *   **Sidebar (`#sidebar`)**: Positioned to the right of the map, it's a scrollable panel containing controls, filters, and the report list/details view.
*   **Footer**: A simple footer at the bottom for copyright information.

### Key UI Components

#### Modals
Modals are used extensively for various interactions to keep the main interface clean:
*   **Report Form Modal (`#report-form-modal`)**: Used for creating new reports or editing existing ones. It includes fields for title, summary, description, location picking (map click, GPS, geocoding), categories, tags, event type, status, and image uploads.
*   **Authentication Modal (`#auth-modal`)**: Guides users through connecting their Nostr identity via NIP-07 or creating/importing a local private key with passphrase protection.
*   **Settings Modal (`#settings-modal`)**: A comprehensive panel for configuring various application settings, organized into sections.
*   **Confirmation Modal (`#confirm-modal`)**: A generic modal for displaying confirmation prompts before sensitive actions (e.g., deleting reports, clearing data).
*   **Passphrase Modal (`#passphrase-modal`)**: A dedicated modal for securely requesting a passphrase to decrypt local private keys.
*   **Onboarding Modal (`#onboarding-info`)**: Displays a welcome message and key concepts for new users on their first visit.

#### Sidebar Content
The sidebar dynamically switches between different views:

*   **Global Controls**:
    *   **"New Report" Button**: Opens the report creation/editing modal.
    *   **"Settings" Button**: Opens the comprehensive settings modal.

*   **Filter Controls (`#filter-controls`)**:
    *   **Search Input**: Text search across report titles, summaries, and content.
    *   **Focus Tag Input**: Displays the currently active focus tag, which filters reports and is applied to new reports.
    *   **Category Select**: Dropdown to filter reports by predefined categories.
    *   **Author Input**: Filter reports by a specific Nostr pubkey (npub or hex).
    *   **Time Range Pickers**: Date and time inputs to filter reports by creation date.
    *   **Apply/Reset Buttons**: Apply all active filters or reset them to default.
    *   **Map Drawing Controls**: Integrates Leaflet.Draw tools (polygon, rectangle, circle) for creating spatial filters.
    *   **Spatial Filter Toggle**: Checkbox to enable/disable filtering reports based on drawn shapes.
    *   **Followed Users Toggle**: Checkbox to show reports only from followed pubkeys.
    *   **Clear All Drawn Shapes Button**: Removes all drawn shapes from the map and database.

*   **Report List (`#report-list-container`, `#report-list`)**:
    *   Displays a list of reports matching the current filters as interactive cards.
    *   Each card shows the report title, a summary snippet, author (short npub), date, and categories.
    *   Clicking a report card switches the sidebar to the "Report Details" view.

*   **Report Details (`#report-detail-container`)**:
    *   Shows the full content of a selected report.
    *   Includes title, full Markdown description, images, location coordinates, and geohash.
    *   Displays author information (profile picture, name, NIP-05, about) with a follow/unfollow button.
    *   **Interactions Section**: Lists reactions (likes/dislikes) and comments associated with the report.
    *   **Reaction Buttons**: Quick buttons for sending `+` or `-` reactions.
    *   **Comment Form**: A text area and submit button for posting comments.
    *   **Mini-Map**: A small, static map showing the report's exact location.
    *   **Edit/Delete Buttons**: Available only to the report's author.
    *   **"Back to List" Button**: Returns to the main report list view.

### Status and Feedback
*   **Connection Status**: Displays "Online" or "Offline" in the header.
*   **Sync Status**: Shows "Synced" or "Syncing (X)" if there are events in the offline queue, with a clickable button to view the queue in settings.
*   **Global Loading Spinner**: A full-screen overlay with a spinner and "Loading..." text, activated during long-running asynchronous operations.
*   **Toast Notifications**: Small, temporary pop-up messages at the bottom of the screen for various feedback (success, error, info, warning), some with a "Copy" button for relevant data (e.g., private key).

## Other Helpful Project Information

### Technologies Used
*   **Frontend**: HTML, CSS, JavaScript (ES Modules)
*   **Mapping**: [Leaflet.js](https://leafletjs.com/), [Leaflet.markercluster](https://github.com/Leaflet/Leaflet.markercluster), [Leaflet.draw](https://github.com/Leaflet/Leaflet.draw)
*   **Nostr**: [nostr-tools](https://github.com/nbd-wtf/nostr-tools)
*   **Geospatial**: [ngeohash](https://github.com/vincentlauzon/ngeohash), [@turf/turf](https://turfjs.org/)
*   **Markdown**: [marked](https://marked.js.org/)
*   **State Management**: Custom lightweight store
*   **Data Storage**: IndexedDB
*   **Offline Capabilities**: [Workbox](https://developers.google.com/web/tools/workbox)
*   **Build Tool**: [Vite](https://vitejs.dev/)

### Setup and Local Development

To set up and run NostrMapper locally:

1.  **Clone the repository:**
    ```bash
    git clone <repository-url>
    cd nostrmapper
    ```
2.  **Install dependencies:**
    ```bash
    npm install
    ```
3.  **Run in development mode:**
    ```bash
    npm run dev
    ```
    This will start a development server, usually at `http://localhost:5173`. The app will automatically reload on code changes.

4.  **Build for production:**
    ```bash
    npm run build
    ```
    This command compiles the application into the `dist/` directory and generates the Service Worker using Workbox. You can then serve the `dist/` directory with a static file server.

### Security Considerations
*   **Private Keys**: While NostrMapper offers local private key management, storing private keys directly in the browser's IndexedDB carries inherent risks. It is **highly recommended** to use a NIP-07 browser extension (like Alby or nos2x) for managing your Nostr identity, as these extensions typically handle keys more securely.
*   **Public Data**: All data published to Nostr is public and immutable. Be mindful of the information you share, especially location data.

### Contributing
(This section is a placeholder. If this were an open-source project, it would include guidelines for contributions.)

### License
(This section is a placeholder. It would typically specify the project's license.)
