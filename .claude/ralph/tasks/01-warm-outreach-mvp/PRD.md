# Feature: Warm Outreach MVP — Module 1

## Vision
Premier module de la plateforme outreach : importer ses contacts LinkedIn chauds, créer ses offres commerciales, laisser l'IA trouver qui contacter en priorité pour chaque offre.

## Problem
Un freelance/consultant a des centaines de contacts LinkedIn mais ne sait pas qui contacter pour quelle offre. Il perd du temps à filtrer manuellement ou il envoie le même message à tout le monde.

## Solution
1. Import CSV contacts LinkedIn (export natif, zéro scraping)
2. Créer ses offres (nom + description + persona cible)
3. LLM analyse l'offre → 5 critères discriminants
4. Score automatique de tous les contacts pour chaque offre
5. Dashboard : contacts triés par pertinence par offre

## Technical Notes
- Stack : Koa + TypeScript + PostgreSQL (pool pg) + RabbitMQ + vitest
- LLM : claude-haiku-4-5 via @anthropic-ai/sdk (à installer)
- Multi-tenant : tenant_id = sub du JWT sur toutes les tables
- Ne pas toucher : auth, LinkedIn scraper, France Travail scraper, Prometheus
- npm test doit passer avant chaque commit
