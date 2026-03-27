# Screen States Checklist

Every screen should be evaluated against this checklist. Not all states apply to every screen — mark as N/A when irrelevant.

## Universal States

These apply to virtually every screen:

- [ ] **Initial / Default** — first load, before any user action
- [ ] **Loading** — data being fetched, spinner or skeleton UI
- [ ] **Populated** — normal state with representative data
- [ ] **Empty** — no data to display (first use, filtered to zero)
- [ ] **Error (system)** — API failure, network error, server down
- [ ] **Error (validation)** — user input doesn't meet requirements
- [ ] **Disabled / Restricted** — user lacks permission for this action
- [ ] **Offline** — no network connectivity (if applicable)

## Form-Specific States

For screens with user input:

- [ ] **Pristine** — form untouched, no validation messages
- [ ] **Dirty** — user has modified at least one field
- [ ] **Submitting** — form submitted, awaiting response
- [ ] **Success** — submission accepted, confirmation shown
- [ ] **Partial validation** — some fields valid, some invalid
- [ ] **Field-level error** — individual field validation messages
- [ ] **Rate limited** — too many submission attempts

## List/Table-Specific States

For screens displaying collections:

- [ ] **Single item** — list with exactly one entry
- [ ] **Many items** — list with enough items to require scrolling
- [ ] **Pagination / Infinite scroll** — loading more items
- [ ] **Filtered** — subset of items shown
- [ ] **Filtered to empty** — filter yields no results
- [ ] **Sorted** — items reordered by column
- [ ] **Searching** — search in progress
- [ ] **Selection** — one or more items selected

## Authentication-Specific States

For screens in auth flows:

- [ ] **Unauthenticated** — no credentials provided
- [ ] **Authenticating** — credentials being verified
- [ ] **Authenticated** — access granted
- [ ] **Pending approval** — credentials valid but awaiting admin approval
- [ ] **Blocked / Locked out** — too many failed attempts
- [ ] **Session expired** — was authenticated, session timed out
- [ ] **Token refreshing** — session being silently renewed

## Dashboard-Specific States

For monitoring or analytics screens:

- [ ] **Real-time updating** — live data streaming in
- [ ] **Stale data** — data older than expected refresh interval
- [ ] **Anomaly detected** — alert or warning condition
- [ ] **Time range changed** — different period selected
- [ ] **Chart loading** — individual widget still fetching

## Modal/Dialog States

For overlay interactions:

- [ ] **Closed** — modal not visible
- [ ] **Opening** — transition animation
- [ ] **Open** — modal visible and interactive
- [ ] **Confirmation** — "are you sure?" secondary dialog
- [ ] **Processing** — modal action in progress
- [ ] **Result** — action complete, showing outcome

## Responsive States

Verify layout at these breakpoints:

- [ ] **Desktop** — 1280px+ width
- [ ] **Tablet** — 768px-1279px width
- [ ] **Mobile** — 375px-767px width
- [ ] **Landscape mobile** — phone in landscape orientation (if relevant)

## Accessibility States

- [ ] **Keyboard focus** — visible focus indicators on interactive elements
- [ ] **Screen reader** — appropriate ARIA labels and roles
- [ ] **High contrast** — sufficient color contrast ratios
- [ ] **Reduced motion** — animations respect prefers-reduced-motion
