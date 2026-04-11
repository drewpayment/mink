// ── Migration Prompts for All 14 Frameworks (Spec 14) ──────────────────────

import type { MigrationPrompt } from "../../types/framework-advisor";

export const MIGRATION_PROMPTS: MigrationPrompt[] = [
  {
    frameworkId: "tailwind-headlessui",
    sections: [
      {
        key: "install",
        content:
          "Install both packages with `npm install tailwindcss @headlessui/react`. Run `npx tailwindcss init -p` to generate `tailwind.config.js` and `postcss.config.js`. Requires React 18+ for Headless UI v2.",
      },
      {
        key: "configure",
        content:
          "Add your source paths to the `content` array in `tailwind.config.js`. Enable the forms and typography plugins if needed via `@tailwindcss/forms` and `@tailwindcss/typography`. Import Tailwind directives (`@tailwind base; @tailwind components; @tailwind utilities;`) in your root CSS file.",
      },
      {
        key: "migrate-components",
        content:
          "Replace custom dropdowns, modals, and toggles with Headless UI's `Menu`, `Dialog`, and `Switch` components. These provide accessible behavior with zero styling — you add all styles via Tailwind classes. Map old components: Modal → Dialog, Select → Listbox, Tooltip → Popover.",
      },
      {
        key: "migrate-styles",
        content:
          "Remove existing CSS-in-JS libraries or component CSS files. Convert all styles to Tailwind utility classes directly on elements. Use the `@apply` directive sparingly in CSS files for repeated patterns. Leverage Tailwind's `group` and `peer` modifiers for interactive states.",
      },
      {
        key: "gotchas",
        content:
          "Headless UI components are unstyled by default — you must provide all visual styles yourself. The `Transition` component requires careful ordering of enter/leave classes. PurgeCSS (built into Tailwind) may remove dynamically constructed class names, so avoid string concatenation for classes.",
      },
      {
        key: "verification",
        content:
          "Run `npx tailwindcss --content ./src/**/*.tsx --output /dev/null` to verify class scanning works. Test all Headless UI components for keyboard navigation and screen reader behavior. Check that the production build tree-shakes unused Tailwind classes correctly.",
      },
    ],
  },
  {
    frameworkId: "shadcn-ui",
    sections: [
      {
        key: "install",
        content:
          "Run `npx shadcn@latest init` to scaffold the project. Install individual components with `npx shadcn@latest add button dialog` etc. Requires React 18+ and Tailwind CSS 3.4+.",
      },
      {
        key: "configure",
        content:
          "The init command creates `components.json` for path aliases and styling preferences. Configure your `tailwind.config.ts` to include the shadcn preset. Set up CSS variables in `globals.css` for theming.",
      },
      {
        key: "migrate-components",
        content:
          "Replace existing UI primitives one-by-one. shadcn components are copied into your codebase at `components/ui/`, so you own the source. Map old components: Button → Button, Modal → Dialog, Dropdown → DropdownMenu.",
      },
      {
        key: "migrate-styles",
        content:
          "Remove old CSS-in-JS or component library styles. shadcn uses Tailwind utility classes with CSS variables for theming. Update className props to use the `cn()` utility for conditional classes.",
      },
      {
        key: "gotchas",
        content:
          "Components are copied, not installed as a package — updates require re-running the add command or manually merging. Some components depend on Radix UI primitives under the hood. Dark mode requires the `dark` class strategy in Tailwind config.",
      },
      {
        key: "verification",
        content:
          "Run `npx tsc --noEmit` to check for type errors. Verify each migrated component renders correctly in both light and dark modes. Run your existing test suite to catch regressions.",
      },
    ],
  },
  {
    frameworkId: "mui",
    sections: [
      {
        key: "install",
        content:
          "Install the core packages with `npm install @mui/material @emotion/react @emotion/styled`. For icons, add `@mui/icons-material`. MUI v6 requires React 18+.",
      },
      {
        key: "configure",
        content:
          "Create a custom theme with `createTheme()` and wrap your app in `<ThemeProvider theme={theme}>`. Add `<CssBaseline />` inside the provider to normalize browser styles. Configure typography, palette, and breakpoints in the theme object.",
      },
      {
        key: "migrate-components",
        content:
          "MUI provides near-complete coverage of common UI patterns. Map old components: Button → Button, Modal → Dialog, Input → TextField, Select → Select, Tabs → Tabs. Use `sx` prop for one-off styles and `styled()` for reusable styled components.",
      },
      {
        key: "migrate-styles",
        content:
          "Replace CSS modules or plain CSS with MUI's `sx` prop or the `styled()` API from `@mui/material/styles`. Access theme values directly in `sx` via callbacks like `sx={{ p: (t) => t.spacing(2) }}`. Remove old global stylesheets that conflict with MUI's baseline.",
      },
      {
        key: "gotchas",
        content:
          "MUI's bundle size is significant — use path imports like `@mui/material/Button` instead of named imports for better tree-shaking. Emotion's SSR requires additional setup with `createCache` and `CacheProvider`. The `sx` prop only works on MUI components, not native HTML elements.",
      },
      {
        key: "verification",
        content:
          "Run `npx tsc --noEmit` and verify no type conflicts between MUI's theme types and your custom declarations. Test SSR pages for FOUC (flash of unstyled content) caused by missing Emotion cache. Confirm the production bundle size with `npx source-map-explorer`.",
      },
    ],
  },
  {
    frameworkId: "chakra-ui",
    sections: [
      {
        key: "install",
        content:
          "Install with `npm install @chakra-ui/react @emotion/react @emotion/styled framer-motion`. Chakra UI v3 drops the framer-motion peer dependency, so check your target version. Requires React 18+.",
      },
      {
        key: "configure",
        content:
          "Wrap your app in `<ChakraProvider>` which includes a default theme and CSS reset. Extend the default theme with `extendTheme()` to set custom colors, fonts, and component variants. For Chakra v3, use `createSystem()` and `defaultConfig` instead.",
      },
      {
        key: "migrate-components",
        content:
          "Map old components: Modal → Modal, Input → Input, Button → Button, Select → Select, Toast → useToast hook. Chakra's `Stack`, `Flex`, and `Grid` components replace most custom layout CSS. Use the `as` prop to render semantic HTML elements.",
      },
      {
        key: "migrate-styles",
        content:
          "Replace CSS files with Chakra's style props directly on components (e.g., `<Box p={4} bg='gray.100'>`). Use the `useColorModeValue` hook for dark mode style switching. Token-based spacing and color scales are available out of the box.",
      },
      {
        key: "gotchas",
        content:
          "Chakra v2 to v3 is a breaking migration — the theming API changed from `extendTheme` to a system-based approach. Framer Motion adds ~30KB gzipped to the bundle in v2. Color mode may flash on SSR without proper cookie-based persistence setup.",
      },
      {
        key: "verification",
        content:
          "Toggle between light and dark modes and verify no style flicker on page load. Run accessibility checks with `axe-core` — Chakra components should pass WCAG 2.1 AA. Verify that custom theme tokens apply correctly across all migrated components.",
      },
    ],
  },
  {
    frameworkId: "ant-design",
    sections: [
      {
        key: "install",
        content:
          "Install with `npm install antd`. Ant Design v5 removed the need for separate CSS imports — styles are injected via CSS-in-JS at runtime. For icons, install `@ant-design/icons` separately.",
      },
      {
        key: "configure",
        content:
          "Wrap your app in `<ConfigProvider theme={{ token: { colorPrimary: '#1677ff' } }}>` to customize the design token system. Use `theme.algorithm` to switch between `theme.defaultAlgorithm`, `theme.darkAlgorithm`, and `theme.compactAlgorithm`. No separate CSS import is needed in v5+.",
      },
      {
        key: "migrate-components",
        content:
          "Ant Design covers a very wide range of enterprise components. Map: Modal → Modal, Table → Table (with built-in sort/filter/pagination), Form → Form (with built-in validation via rules), DatePicker → DatePicker. Use `App.useApp()` for message/notification/modal imperative APIs.",
      },
      {
        key: "migrate-styles",
        content:
          "Remove any v4 `import 'antd/dist/antd.css'` imports. In v5, override styles through the `ConfigProvider` token system or component-level `styles` and `classNames` props. Avoid `!important` overrides — use the `theme.components` config for per-component tokens.",
      },
      {
        key: "gotchas",
        content:
          "Ant Design's CSS-in-JS runtime (cssinjs) can cause SSR hydration mismatches — use `extractStyle` from `@ant-design/cssinjs` for server rendering. The `dayjs` locale must be imported manually for DatePicker localization. Bundle size is large; use `babel-plugin-import` or tree-shaking for optimization.",
      },
      {
        key: "verification",
        content:
          "Verify SSR pages don't flash unstyled content by checking the HTML source for inline `<style>` tags. Run `npx tsc --noEmit` to catch any v4-to-v5 API breakages. Test Form validation rules and Table pagination with realistic data sets.",
      },
    ],
  },
  {
    frameworkId: "radix-ui",
    sections: [
      {
        key: "install",
        content:
          "Install individual primitives as needed: `npm install @radix-ui/react-dialog @radix-ui/react-dropdown-menu @radix-ui/react-tooltip`. Each primitive is a separate package for optimal tree-shaking. Requires React 18+.",
      },
      {
        key: "configure",
        content:
          "Radix primitives are unstyled and require no global configuration. Wrap your app in `<Theme>` from `@radix-ui/themes` only if using the pre-styled Radix Themes layer. For primitives alone, configure your own CSS strategy (Tailwind, CSS Modules, etc.).",
      },
      {
        key: "migrate-components",
        content:
          "Map old components: Modal → Dialog, Dropdown → DropdownMenu, Popover → Popover, Switch → Switch, Tabs → Tabs. Each Radix component uses a compound pattern (e.g., `Dialog.Root`, `Dialog.Trigger`, `Dialog.Content`). Compose your own styled wrappers around the primitives.",
      },
      {
        key: "migrate-styles",
        content:
          "Radix exposes data attributes like `data-state='open'` that you target with CSS selectors or Tailwind's `data-[state=open]:` modifier. Animations should use CSS transitions on these data attributes rather than JS-based animation. Remove any prior library's scoped styles that conflict.",
      },
      {
        key: "gotchas",
        content:
          "Radix primitives manage focus trapping, arrow-key navigation, and escape-to-close internally — don't add your own handlers that conflict. Portal-based components render outside the DOM hierarchy, which can break CSS inheritance. Some primitives require `asChild` to forward props to custom trigger elements.",
      },
      {
        key: "verification",
        content:
          "Test keyboard navigation for every Radix primitive: Tab, Enter, Escape, and arrow keys should work as expected. Verify that portaled content (Dialog, Popover) renders in the correct stacking context. Run screen reader tests to confirm ARIA attributes are applied correctly.",
      },
    ],
  },
  {
    frameworkId: "mantine",
    sections: [
      {
        key: "install",
        content:
          "Install with `npm install @mantine/core @mantine/hooks @mantine/form`. Add `postcss-preset-mantine` and `postcss-simple-vars` as dev dependencies for the PostCSS-based styling. Requires React 18+.",
      },
      {
        key: "configure",
        content:
          "Wrap your app in `<MantineProvider>` and create a theme with `createTheme()`. Configure PostCSS by adding `postcss-preset-mantine` to your `postcss.config.js`. Import `@mantine/core/styles.css` in your root entry point.",
      },
      {
        key: "migrate-components",
        content:
          "Mantine has 100+ components covering most needs. Map: Modal → Modal, Button → Button, Input → TextInput, Select → Select, Tabs → Tabs, Toast → notifications (from `@mantine/notifications`). Use `@mantine/dates` for date pickers and `@mantine/dropzone` for file uploads.",
      },
      {
        key: "migrate-styles",
        content:
          "Use Mantine's `classNames` and `styles` props for component overrides. For custom styling, use CSS Modules (the recommended approach) with `.module.css` files. Access theme tokens in CSS via `var(--mantine-color-blue-6)` CSS variables.",
      },
      {
        key: "gotchas",
        content:
          "Mantine v7 switched from Emotion (CSS-in-JS) to PostCSS — migrating from v6 requires replacing all `createStyles` calls. The `@mantine/core/styles.css` import is required or components render unstyled. SSR requires `ColorSchemeScript` in the HTML head to prevent color scheme flicker.",
      },
      {
        key: "verification",
        content:
          "Verify the PostCSS build outputs correct CSS by inspecting the compiled styles. Test color scheme switching between light, dark, and auto modes. Run `npx tsc --noEmit` to check that Mantine's strict prop types are satisfied.",
      },
    ],
  },
  {
    frameworkId: "daisyui",
    sections: [
      {
        key: "install",
        content:
          "Install with `npm install daisyui` and add it as a Tailwind plugin in `tailwind.config.js`: `plugins: [require('daisyui')]`. DaisyUI requires Tailwind CSS 3.0+ as a peer dependency.",
      },
      {
        key: "configure",
        content:
          "Configure available themes in `tailwind.config.js` under `daisyui: { themes: ['light', 'dark', 'cupcake'] }`. Set a default theme with `data-theme` attribute on your `<html>` element. Create custom themes by providing a theme object in the themes array.",
      },
      {
        key: "migrate-components",
        content:
          "DaisyUI provides semantic CSS classes like `btn`, `card`, `modal`, `input`, `navbar`. Replace custom component styles with these classes directly on HTML elements. Map old components to class-based markup: Button → `<button class='btn btn-primary'>`, Modal → `<dialog class='modal'>`.",
      },
      {
        key: "migrate-styles",
        content:
          "Replace existing component CSS with DaisyUI's semantic classes. Combine DaisyUI classes with Tailwind utilities for fine-tuning (e.g., `btn btn-primary w-full mt-4`). Remove redundant color and spacing definitions that are now handled by themes.",
      },
      {
        key: "gotchas",
        content:
          "DaisyUI is CSS-only with no JavaScript — interactive behaviors like modal open/close must be handled by your framework. Some class names like `btn` may conflict with other libraries. Theme switching requires JavaScript to update the `data-theme` attribute on the root element.",
      },
      {
        key: "verification",
        content:
          "Cycle through all configured themes and verify consistent rendering. Check that DaisyUI classes don't conflict with existing Tailwind utility classes. Verify interactive components (modals, dropdowns) work correctly with your own JS event handlers.",
      },
    ],
  },
  {
    frameworkId: "vuetify",
    sections: [
      {
        key: "install",
        content:
          "Install with `npm install vuetify` and add the Vite plugin via `npm install -D vite-plugin-vuetify`. For a new project, use `npm create vuetify@latest`. Requires Vue 3.3+.",
      },
      {
        key: "configure",
        content:
          "Create a Vuetify instance with `createVuetify()` in a plugin file and pass it to `app.use(vuetify)`. Configure the Vite plugin in `vite.config.ts` for automatic component tree-shaking. Import `vuetify/styles` in your main entry file and optionally add `@mdi/font` for Material Design Icons.",
      },
      {
        key: "migrate-components",
        content:
          "Vuetify provides a comprehensive Material Design component set. Map: Modal → v-dialog, Button → v-btn, Input → v-text-field, Select → v-select, Tabs → v-tabs, DataTable → v-data-table. All components use the `v-` prefix and follow Material Design 3 guidelines.",
      },
      {
        key: "migrate-styles",
        content:
          "Remove existing component CSS and let Vuetify's SASS-based theme handle styling. Customize via the `theme` option in `createVuetify()` with `colors`, `variables`, and dark/light variations. Use the `class` and `style` props alongside Vuetify's built-in utility classes like `ma-4`, `pa-2`, `text-h6`.",
      },
      {
        key: "gotchas",
        content:
          "Vuetify v3 is Vue 3 only — there is no backward compatibility with Vue 2. The `vite-plugin-vuetify` is essential for tree-shaking; without it, the full library is bundled (~300KB gzipped). SSR with Nuxt requires the `vuetify-nuxt-module` for proper style injection.",
      },
      {
        key: "verification",
        content:
          "Run `npx vue-tsc --noEmit` to verify TypeScript types. Check the bundle analyzer output to confirm tree-shaking is working via the Vite plugin. Test responsive breakpoints using Vuetify's `useDisplay()` composable.",
      },
    ],
  },
  {
    frameworkId: "primevue",
    sections: [
      {
        key: "install",
        content:
          "Install with `npm install primevue @primevue/themes`. For icons, add `npm install primeicons`. PrimeVue v4 requires Vue 3.4+ and uses a new theming architecture.",
      },
      {
        key: "configure",
        content:
          "Register PrimeVue in your app with `app.use(PrimeVue, { theme: { preset: Aura } })` using one of the built-in presets (Aura, Lara, Nora). Import `primeicons/primeicons.css` for the icon font. Configure individual component defaults through the `pt` (pass-through) option.",
      },
      {
        key: "migrate-components",
        content:
          "PrimeVue offers 90+ components including advanced data components. Map: Modal → Dialog, Button → Button, Input → InputText, Select → Dropdown, DataTable → DataTable (with sort, filter, pagination, row expansion). Use the `AutoComplete`, `TreeTable`, and `OrganizationChart` for complex UI needs.",
      },
      {
        key: "migrate-styles",
        content:
          "PrimeVue v4 uses a design token system via the `@primevue/themes` package. Override tokens at the global or component level using `definePreset()`. Remove old PrimeVue v3 CSS theme imports (`primevue/resources/themes/...`) as v4 handles theming differently.",
      },
      {
        key: "gotchas",
        content:
          "PrimeVue v3 to v4 is a major migration — the theme architecture completely changed from CSS to a design-token system. The `pt` (pass-through) API replaces direct CSS class overrides. Some component prop names changed between v3 and v4, so consult the migration guide.",
      },
      {
        key: "verification",
        content:
          "Run `npx vue-tsc --noEmit` to verify type safety. Test DataTable with large datasets (1000+ rows) to confirm virtual scrolling performance. Verify that the chosen preset applies consistently across all components in both light and dark modes.",
      },
    ],
  },
  {
    frameworkId: "skeleton-svelte",
    sections: [
      {
        key: "install",
        content:
          "Install with `npm install @skeletonlabs/skeleton @skeletonlabs/tw-plugin`. Skeleton requires Tailwind CSS 3.0+ and SvelteKit as the recommended framework. Add the plugin to your Tailwind config.",
      },
      {
        key: "configure",
        content:
          "Add `skeleton()` to the plugins array in `tailwind.config.ts` and register a theme: `skeleton({ themes: { preset: ['skeleton', 'wintry', 'modern'] } })`. Import Skeleton's base styles with `import '@skeletonlabs/skeleton/styles/all.css'` in your root layout. Set the active theme on the `<body>` element with `data-theme`.",
      },
      {
        key: "migrate-components",
        content:
          "Map old components: Modal → Modal (via `getModalStore()`), Button → button with Skeleton classes, Input → input elements with `input` class, Tabs → TabGroup/Tab, Table → Table with `tableMapperValues`. Skeleton uses Svelte actions and stores for interactive behaviors.",
      },
      {
        key: "migrate-styles",
        content:
          "Replace component CSS with Skeleton's Tailwind-integrated utility classes and design tokens. Use token classes like `variant-filled-primary`, `variant-ghost-secondary` for consistent theming. Access theme CSS variables like `var(--color-primary-500)` for custom styling.",
      },
      {
        key: "gotchas",
        content:
          "Skeleton v2 introduced breaking changes to the theming system and component APIs from v1. Interactive components rely on Svelte stores (e.g., `modalStore`, `toastStore`) which must be initialized in the root layout. Skeleton is Svelte-only — there is no React or Vue version.",
      },
      {
        key: "verification",
        content:
          "Switch between installed themes using the `data-theme` attribute and verify consistent rendering. Test store-based components (Modal, Toast, Drawer) for proper initialization and cleanup. Verify SvelteKit SSR renders Skeleton components without hydration errors.",
      },
    ],
  },
  {
    frameworkId: "angular-material",
    sections: [
      {
        key: "install",
        content:
          "Run `ng add @angular/material` which installs the package, sets up animations, and configures a theme. This schematic modifies `angular.json`, `app.module.ts`, and `styles.css` automatically. Requires Angular 17+.",
      },
      {
        key: "configure",
        content:
          "Import individual component modules (e.g., `MatButtonModule`, `MatDialogModule`) in your feature modules or use standalone component imports. Configure a custom theme in your SCSS by calling `@use '@angular/material' as mat` and defining custom palettes with `mat.define-theme()`. Add `provideAnimationsAsync()` to your app config.",
      },
      {
        key: "migrate-components",
        content:
          "Map old components: Modal → MatDialog (opened via `MatDialog.open()`), Button → mat-button/mat-raised-button, Input → matInput directive on `<input>`, Table → mat-table with matSort and matPaginator. Angular Material uses directives heavily — most components are attribute selectors on native elements.",
      },
      {
        key: "migrate-styles",
        content:
          "Use Angular Material's SCSS theming API to define `$theme: mat.define-theme(...)` and apply it with `@include mat.all-component-themes($theme)`. Override individual component styles using `::ng-deep` sparingly or the component's `encapsulation: ViewEncapsulation.None`. Use CSS custom properties exposed by M3 theme for custom component styling.",
      },
      {
        key: "gotchas",
        content:
          "Angular Material v17+ defaults to Material Design 3 (M3) — M2 compatibility is available but deprecated. The `MatDialog` service injects via DI, not template markup, which is a different pattern from most frameworks. `ViewEncapsulation` can prevent style overrides; prefer `::ng-deep` or global theme variables.",
      },
      {
        key: "verification",
        content:
          "Run `ng build --configuration production` and check for compilation errors and warnings. Test that all MatDialog instances open and close correctly with proper focus management. Verify the custom SCSS theme compiles without errors using `ng serve`.",
      },
    ],
  },
  {
    frameworkId: "flowbite",
    sections: [
      {
        key: "install",
        content:
          "Install with `npm install flowbite` and add it as a Tailwind plugin: `plugins: [require('flowbite/plugin')]`. For React, use `npm install flowbite-react` instead. Add `node_modules/flowbite/**/*.js` to the Tailwind `content` array.",
      },
      {
        key: "configure",
        content:
          "The Flowbite Tailwind plugin extends your config with additional colors and component classes. For Flowbite React, wrap your app in `<Flowbite>` provider for theme customization. Configure dark mode by setting `darkMode: 'class'` in your Tailwind config.",
      },
      {
        key: "migrate-components",
        content:
          "Map old components: Modal → Modal, Button → Button, Input → TextInput, Navbar → Navbar, Card → Card, Dropdown → Dropdown. Flowbite React provides pre-built components, while vanilla Flowbite uses Tailwind classes with optional JS for interactivity via `flowbite.js`.",
      },
      {
        key: "migrate-styles",
        content:
          "Flowbite builds on Tailwind utility classes, so existing Tailwind styles remain compatible. Customize component themes through the `theme` prop in Flowbite React or by overriding the default Tailwind classes directly. Use the Flowbite color palette tokens or replace them with your brand colors in `tailwind.config.js`.",
      },
      {
        key: "gotchas",
        content:
          "Vanilla Flowbite requires including the `flowbite.js` script for interactive components (dropdowns, modals) — this is not needed with Flowbite React. The Tailwind `content` config must include Flowbite's JS files or the interactive component classes get purged. Some Flowbite React components differ in API from the vanilla HTML version.",
      },
      {
        key: "verification",
        content:
          "Verify interactive components (dropdowns, modals, tooltips) work with keyboard and mouse. Test dark mode toggle across all Flowbite components. Check the Tailwind production build to ensure Flowbite classes are included in the purged output.",
      },
    ],
  },
  {
    frameworkId: "park-ui",
    sections: [
      {
        key: "install",
        content:
          "Install with `npm install @park-ui/panda-preset` for Panda CSS or `npm install @park-ui/tailwind-plugin` for Tailwind. Park UI works with React, Vue, and Solid — install the matching Ark UI primitive package (e.g., `@ark-ui/react`). Components are copied into your project similar to shadcn.",
      },
      {
        key: "configure",
        content:
          "For Panda CSS: add the Park UI preset to `panda.config.ts` via `presets: [parkUiPreset]`. For Tailwind: add the plugin to `tailwind.config.ts` and configure the color palette. Set up path aliases so generated components resolve correctly in your project.",
      },
      {
        key: "migrate-components",
        content:
          "Map old components: Modal → Dialog, Button → Button, Input → Input, Tabs → Tabs, Select → Select. Components are generated into your codebase via the CLI or manual copy. Park UI is built on Ark UI primitives, which provide the accessible behavior layer.",
      },
      {
        key: "migrate-styles",
        content:
          "Park UI supports both Panda CSS (utility-first, zero-runtime) and Tailwind CSS. For Panda, use style recipes and token-based props. For Tailwind, use the provided utility classes alongside your existing Tailwind workflow. Theming is token-driven with support for multiple color palettes.",
      },
      {
        key: "gotchas",
        content:
          "Park UI is relatively new — the component library is smaller than mature alternatives. The choice between Panda CSS and Tailwind as the styling engine affects your config and available features. Ark UI (the primitive layer) has its own API patterns that differ from Radix UI despite similar goals.",
      },
      {
        key: "verification",
        content:
          "Run the type checker (`npx tsc --noEmit`) to validate component prop types from Ark UI. Test all interactive components for accessibility — Park UI inherits Ark UI's WAI-ARIA compliance. Verify that the chosen styling engine (Panda or Tailwind) compiles without conflicts.",
      },
    ],
  },
];

export function getMigrationPrompt(
  frameworkId: string,
): MigrationPrompt | undefined {
  return MIGRATION_PROMPTS.find((p) => p.frameworkId === frameworkId);
}
