# Deployment pipeline

Every change follows the same path from a developer's laptop to production.

1. **Pull request** — a branch is opened against `main`. Opening the PR triggers
   the CI workflow.
2. **CI checks** — lint, typecheck and unit tests run in parallel. All three must
   pass before review is allowed.
3. **Review** — one approval from a code owner is required. The PR cannot merge
   without it.
4. **Merge to main** — merging builds a container image tagged with the commit sha
   and pushes it to the registry.
5. **Deploy to staging** — the new image is deployed to staging automatically. No
   human step. Smoke tests run against staging for ten minutes.
6. **Manual promotion** — a release manager promotes the staging image to
   production. This is the only manual gate in the pipeline.
7. **Production rollout** — the image rolls out to 10% of traffic for fifteen
   minutes, then to 100% if the error rate stays flat.
8. **Rollback** — any engineer can roll back to the previous image with one
   command. Rollbacks skip every gate.

Nothing is ever deployed straight to production. Staging is mandatory, and the
promotion step is always a person.
