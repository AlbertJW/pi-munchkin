# Intended behavior (authoritative)

This document is the reference for what CORRECT means in this service. Where code and this
document disagree, the code is wrong.

## Money
All money is integer **cents**, end to end. No floating-point currency arithmetic anywhere:
line totals, subtotals, tax, and discounts are computed in cents and rounded half-up only at
the final tax/discount step.

## Orders
- An order line must have an integer quantity of **at least 1**. Zero or negative quantities
  are invalid and must be rejected.
- Placing an order decrements stock immediately; stock reads must always reflect the latest
  placements (no stale values).
- `listOrders()` returns orders in **placement order**. Reporting helpers must never reorder
  or otherwise mutate the underlying order log.

## Pricing
- Subtotal: sum of line `priceCents × qty`.
- Tax: **per-category** rates from `data/catalog.json` `taxRates` — there is no flat rate.
- Discount: a percentage applied **after tax** to the taxed total, rounded half-up.

## Pagination
`page(items, pageNumber, pageSize)` returns exactly `pageSize` items for a full page
(1-indexed pages). Page 1 of a 20-item list with size 10 is items 1–10.

## Reports
Daily revenue groups orders by **full calendar date (YYYY-MM-DD, UTC)** — never by
day-of-month alone.
