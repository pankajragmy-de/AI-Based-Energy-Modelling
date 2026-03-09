# Meta Energy Framework

An open-source, web-based energy modeling tool acting as a "mega-framework" over top of OEMOF, REMix, PyPSA, and FINE. It provides a standard UI (drag-and-drop canvas) and translates visual models into the Universal Common Data Model (UCDM) natively used by the underlying Python frameworks.

## Deployment Strategy
1. **Frontend (Next.js/HTML)**: Deployable to Vercel/Netlify perfectly natively.
2. **Backend Engine (FastAPI)**: Deployable to AWS ECS (Docker) or Heroku.
3. **CI/CD Sync**: Managed via the embedded `.github/workflows/sync_pipeline.yml`.

## Local Run
Open `frontend/index.html` in your browser.
