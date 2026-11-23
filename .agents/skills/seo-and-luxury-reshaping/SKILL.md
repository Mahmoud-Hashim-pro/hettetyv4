---
name: seo-and-luxury-reshaping
description: >-
  Guidelines for reshaping a real estate or luxury SaaS web application while
  preserving brand identity: applying SOLID filter architectures, Clean Code,
  comprehensive technical SEO (JSON-LD, OpenGraph, Canonical, hreflang,
  semantic HTML5, robots.txt, sitemap.xml), Core Web Vitals optimization, and
  bilingual Arabic RTL / English LTR craft.
---

# Technical SEO & Luxury Site Reshaping Standards

Use this skill when elevating an existing application's visual craft, discovery UX, and search engine visibility without losing its established brand DNA or breaking core subsystems (such as 3D engines).

## 1. Brand-Faithful Reshaping
- Preserve core palette tokens (e.g., Navy `#1b2c4d` + Accent Orange `#e67e22`) and typography pairing (`Cairo` for Arabic RTL with `letter-spacing: normal`, `Montserrat` + `Inter` for English LTR).
- Elevate hierarchy with crisp surface elevation, logical CSS spacing (`ps-*`, `pe-*`, `ms-*`, `me-*`, `text-start`), responsive grid/list/projects switching, honest media badges, skeleton loaders, and purposeful empty states.
- **Protect Core Subsystems**: Isolate 3D WebGL/Gaussian Splatting viewers behind lazy-loaded boundaries and never alter verified spatial rendering/calibration math during UI reshaping.

## 2. SOLID Property Discovery & Filtering
- Encapsulate filtering and sorting in a pure Use Case (`FilterPropertiesUseCase`) built from composable specification predicates (Open/Closed Principle & Single Responsibility Principle).
- Expose both an immediate quick-filter bar (search, type, price bounds, sort) and an expandable advanced-filters panel (area, bedrooms, bathrooms, finishing, delivery timeline, district chips, Verified Only, 3D Tour Only, Installments), plus active filter pills and a side-by-side Property Comparison drawer.

## 3. Production Technical SEO Checklist
- **Dynamic Per-Route Metadata (`SeoManager`)**: Update `document.title`, `meta[name="description"]`, `link[rel="canonical"]`, `og:*`, `twitter:*`, and `html[lang]/[dir]` on every navigation or entity view.
- **Structured Data (JSON-LD)**: Inject valid `Schema.org` graphs for `Organization`, `WebSite` (with `SearchAction`), `RealEstateListing` (with `Offer`, price, currency, area, rooms, address), and `BreadcrumbList`.
- **Crawlability & Performance**: Ship `public/robots.txt` (blocking `/admin` / `/api/`), `public/sitemap.xml`, semantic HTML5 landmarks (`<header>`, `<nav>`, `<main>`, `<section>`, `<article>`, `<footer>`), lazy-loaded images with descriptive `alt`, and zero bloated unused vendor chunks.
