---
name: Artifact Hub
description: Self-hosted artifact viewer and review hub; design-tool style neutral chrome around the work.
colors:
  paper: "#f5f5f5"
  surface: "#ffffff"
  ink: "#1e1e1e"
  ink-muted: "#666666"
  hairline: "#e1e1e1"
  wash: "#ebebeb"
  canvas: "#e6e6e6"
  canvas-dot: "#cdcdcd"
  azure: "#0d6fd6"
  azure-ink: "#ffffff"
  alarm: "#c4281c"
  paper-dark: "#1e1e1e"
  surface-dark: "#2c2c2c"
  ink-dark: "#f2f2f2"
  ink-muted-dark: "#a6a6a6"
  hairline-dark: "#424242"
  wash-dark: "#383838"
  canvas-dark: "#181818"
  azure-dark: "#4da3ff"
  azure-ink-dark: "#0a1a2e"
  alarm-dark: "#ff8b80"
typography:
  title:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 600
    lineHeight: 1.25
  body:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.4
rounded:
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "14px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "32px"
components:
  button-primary:
    backgroundColor: "{colors.azure}"
    textColor: "{colors.azure-ink}"
    rounded: "{rounded.md}"
    height: "36px"
  button-outline:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    height: "36px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
    padding: "24px"
---

# Design System: Artifact Hub

## Overview

**Creative North Star: "The Gallery Wall"** (rendered as the viewer's canvas: boards on a dotted wall)

The hub is the wall, the artifacts are the pictures. Chrome borrows the manner of design tools (Figma, Penpot, Adobe XD, Canva): cool neutral grays, hairline panels, compact controls, and a single clear blue for selection and the primary action. It is deliberately not warm, not black-and-orange, and not the cream-and-terracotta look chat products default to. Nothing in the chrome is allowed to out-shout a published artifact.

Pages around the list breathe: generous outer margins, a narrow centered column, rows with real padding. Inside the viewer, density rises (toolbar, panels, comment list) but stays on the same tokens. The blue accent marks state and ownership only: current selection, unread count, the primary action of a screen.

The system rejects the default-AI dashboard look: purple-blue gradients, glass cards, icon-in-a-circle tiles, side-stripe callouts, and decorative shadows.

**Key Characteristics:**
- True-neutral grays, light (#f5f5f5 page, white panels) and dark (#1e1e1e page, #2c2c2c panels), as in design-tool UIs.
- Azure appears on roughly one element per screen; it is also the selection color.
- Flat at rest; shadow only on layers that float above the page.
- System sans only; hierarchy comes from size, weight and spacing.
- Everything interactive is a shadcn-vue component.

## Colors

Cool-neutral grays with a single azure accent. Values come from `app/assets/css/main.css`; the palette follows design-tool chrome rather than chat-product defaults; dark values live under `prefers-color-scheme: dark` and `[data-theme]`.

### Primary
- **Azure** (#0d6fd6 light, #4da3ff dark): the primary button, selection outlines, comment number badges, focus ring. Rare by design; the dark variant carries dark ink text (#0a1a2e), never white.

### Neutral
- **Paper** (#f5f5f5 / #1e1e1e): page background.
- **Surface** (#ffffff / #2c2c2c): cards, popovers, toolbars, side panel.
- **Ink** (#1e1e1e / #f2f2f2): body text and titles.
- **Ink Muted** (#666666 / #a6a6a6): metadata, helper text, timestamps.
- **Hairline** (#e1e1e1 / #424242): every border and divider.
- **Wash** (#ebebeb / #383838): hover and secondary fills.
- **Canvas** (#e6e6e6 / #181818) with **Canvas Dot** (#cdcdcd / #2d2d2d): the infinite-canvas ground behind boards.
- **Alarm** (#c4281c / #ff8b80): destructive actions, errors, detached comments.

### Named Rules
**The One Mark Rule.** Azure is used on at most one control or mark per region. If two things are azure, one of them should not be.
**The No Warm Default Rule.** No orange, terracotta, cream or brown-black neutrals. Grays carry no hue.
**The Token Rule.** Chrome uses the shadcn tokens (`bg-background`, `text-muted-foreground`, `border-border`). Hex values and the legacy `--bg/--panel/--line` aliases do not appear in new markup.

## Typography

**Display / Body / Label Font:** the system UI stack (`ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`).

**Character:** plain and native. The product shows other people's designs, so its own typography stays out of their way.

### Hierarchy
- **Title** (600, 22px, 1.25): page titles such as "Artifacts".
- **Heading** (600, 15px): artifact title in the viewer bar, card titles.
- **Body** (400, 14px, 1.5): default text and controls.
- **Label** (500, 12px): metadata, version tags, badge text, column labels. Not uppercase.

### Named Rules
**The Two Weights Rule.** 400 for text, 600 for names. Weight 500 is only for small labels.

## Layout

**The Canvas Idiom.** The whole app is the viewer's canvas: a dotted ground (Canvas / Canvas Dot, 24px grid), floating pills pinned at 12px from the edges, and content set on the ground as boards. Top-left pill: product name and main sections. Top-right pill: page actions and the account menu. No full-width header bar and no sidebar.

Page content is a centered column (max 1024px, 16px gutters) starting below the pills. Each region is a board: a 12px muted label above, a flat frame (1px hairline, 12px radius, Surface fill) below. Rows inside a board are full-bleed ghost buttons separated by hairlines. The viewer keeps the same pills, so moving from list to artifact does not move the chrome. Under 800px the viewer's comment panel drops below the stage; the pills stay.

## Elevation & Depth

Flat with hairlines. Boards are flat: a 1px hairline frame on the dotted ground. Shadows are reserved for layers that float: the pills, menus, popovers and dialogs (`.float`, 0 4px 18px at 14% black, 50% in dark).

### Named Rules
**The Float-Only Rule.** A shadow means "this sits above the page and can be dismissed". Cards in a list never carry one.

## Shapes

Gently rounded: 8px controls, 10px (`--radius`) inputs and rows, 14px for panels and the floating toolbar, full-round only for count badges. Borders are always full 1px hairlines; no one-sided accent borders.

## Components

### Buttons
- **Shape:** 8px radius, 36px default height; icon buttons 28–32px.
- **Primary:** Azure fill, white label (dark ink on the dark-theme azure). One per region.
- **Outline / Ghost:** Paper fill with hairline border, or transparent; hover to Wash.
- **Focus:** 3px ring at 50% azure.

### Cards / Containers
- **Corner Style:** 14px. **Background:** Surface. **Border:** hairline. **Padding:** 24px. No shadow at rest.

### Inputs / Fields
- **Style:** transparent fill, hairline border, 8px radius, 36px height. **Focus:** ring plus border shift to azure. **Error:** Alarm text under the field, `role="alert"`.

### Navigation
Two floating pills on every owner page. List and dashboard: product name plus Dashboard and Artifacts links (current page gets the Wash fill) on the left; page actions and the avatar menu (theme light/system/dark, sign out) on the right. Viewer: back, title menu, version on the left; edit, present, comment, share, comments panel on the right.

### Comment Thread Popover
A 320px Surface card anchored to the marker, numbered azure badge, replies separated by spacing and a hairline, never a colored stripe.

## Do's and Don'ts

### Do:
- **Do** build every control from `app/components/ui`.
- **Do** keep chrome neutral so artifacts read first.
- **Do** put new pages on the dotted ground with floating pills and labelled boards.
- **Do** show real data only; empty states say what to do next.
- **Do** support light and dark with the same tokens.

### Don't:
- **Don't** use side-stripe borders (`border-left` > 1px) as accent on cards, replies or alerts.
- **Don't** add gradient fills, glass blur, or icon-in-circle feature tiles.
- **Don't** put shadows on resting cards.
- **Don't** add a sidebar or a full-width header bar; the pills are the chrome.
- **Don't** use big-number stat tiles; state facts in one muted line.
- **Don't** use plain `<button>`, `<select>` or `<input>` for UI controls.
