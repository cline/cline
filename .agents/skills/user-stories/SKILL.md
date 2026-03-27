---
name: user-stories
description: "Create user stories following the 3 C's (Card, Conversation, Confirmation) and INVEST criteria with descriptions, design links, and acceptance criteria. Use when writing user stories, breaking down features into backlog items, or defining acceptance criteria."
---
# User Stories

Create user stories following the 3 C's (Card, Conversation, Confirmation) and INVEST criteria. Generates stories with descriptions, design links, and acceptance criteria.

**Use when:** Writing user stories, breaking down features into stories, creating backlog items, or defining acceptance criteria.

**Arguments:**
- `$PRODUCT`: The product or system name
- `$FEATURE`: The new feature to break into stories
- `$DESIGN`: Link to design files (Figma, Miro, etc.)
- `$ASSUMPTIONS`: Key assumptions or context

## Step-by-Step Process

1. **Analyze the feature** based on provided design and context
2. **Identify user roles** and distinct user journeys
3. **Apply 3 C's framework:**
   - Card: Simple title and one-liner
   - Conversation: Detailed discussion of intent
   - Confirmation: Clear acceptance criteria
4. **Respect INVEST criteria:** Independent, Negotiable, Valuable, Estimable, Small, Testable
5. **Use plain language** a primary school graduate can understand
6. **Link to design files** for visual reference
7. **Output user stories** in structured format

## Story Template

**Title:** [Feature name]

**Description:** As a [user role], I want to [action], so that [benefit].

**Design:** [Link to design files]

**Acceptance Criteria:**
1. [Clear, testable criterion]
2. [Observable behavior]
3. [System validates correctly]
4. [Edge case handling]
5. [Performance or accessibility consideration]
6. [Integration point]

## Example User Story

**Title:** Recently Viewed Section

**Description:** As an Online Shopper, I want to see a 'Recently viewed' section on the product page to easily revisit items I considered.

**Design:** [Figma link]

**Acceptance Criteria:**
1. The 'Recently viewed' section is displayed at the bottom of the product page for every user who has previously viewed at least 1 product.
2. It is not displayed for users visiting the first product page of their session.
3. The current product itself is excluded from the displayed items.
4. The section showcases product cards or thumbnails with images, titles, and prices.
5. Each product card indicates when it was viewed (e.g., 'Viewed 5 minutes ago').
6. Clicking on a product card leads the user to the corresponding product page.

## Output Deliverables

- Complete set of user stories for the feature
- Each story includes title, description, design link, and 4-6 acceptance criteria
- Stories are independent and can be developed in any order
- Stories are sized for one sprint cycle
- Stories reference related design documentation

---

### Further Reading

- [How to Write User Stories: The Ultimate Guide](https://www.productcompass.pm/p/how-to-write-user-stories)
