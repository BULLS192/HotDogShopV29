# V28 Route-Table Engine

This build replaces bracket generation with a route-table engine.

Exact route tables encoded from the reference PDF screenshots for:
- 3 teams
- 4 teams
- 5 teams
- 6 teams
- 7 teams
- 8 teams
- 9 teams
- 10 teams

11-20 are supported by deterministic route-table fallback and validated before rendering.
Next refinement step should replace 11-20 fallback maps with hand-encoded PDF maps once each page is manually verified.

Critical 8-team reference:
- WB: W1 1v8, W2 4v5, W3 3v6, W4 2v7; W7=W1/W2, W8=W3/W4, W11=W7/W8.
- LB: L5=L1/L2, L6=L3/L4, L9=L8/W5, L10=L7/W6, L12=W9/W10, L13=L11/W12.

Critical 9-team reference:
- WB: W1 8v9, W2 2v7, W3 3v6, W4 4v5, W5 1/W1, W9 W2/W3, W10 W5/W4, W13 W9/W10.
- LB: L6=L1/L2, L7=L4/L5, L8=W6/L3, L11=W7/L9, L12=W8/L10, L14=W12/W11, L15=L13/W14.

Critical 10-team reference:
- WB: W1 8v9, W2 7v10, W3 4v5, W4 3v6, W5 1/W1, W6 2/W2, W11 W3/W5, W12 W6/W4, W15 W11/W12.
- LB: L7=L2/L5, L8=L1/L6, L9=W7/L3, L10=W8/L4, L13=L12/W9, L14=W10/L11, L16=W13/W14, L17=L15/W16.
