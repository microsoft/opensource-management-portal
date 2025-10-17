# GitHub Copilot Instructions - Microsoft Open Source Management Portal

## Repository Overview

This is Microsoft's **Open Source Management Portal**, a large-scale TypeScript/Node.js application with React frontend that manages GitHub operations for Microsoft's open source engineering. It serves almost a hundred thousand engineers and handles enterprise-level GitHub organization management, repository creation, compliance workflows, and background automation jobs.

**Key Stats:**

- Backend: TypeScript/Node.js (main application)
- Frontend: React with TypeScript (in `frontend/` directory) powered by Vite
- Size: ~250 source files, complex enterprise architecture, monolith: web app, cronjobs, frontend
- Runtime: Node.js 20+, targets Azure Linux containers and AKS

## Essential Build & Development Commands

**CRITICAL:** Always run commands from the repository root unless specified otherwise.

### 1. Installation (Prerequisites)

```bash
# Install backend dependencies (likely requires Azure Artifacts authentication)
npm install

# Install frontend dependencies (likely Azure Artifacts authentication)
pushd frontend && npm install && popd
```

### 2. Build Commands (Order Matters)

```bash
# Build backend only (TypeScript compilation)
npm run build

# Build frontend only (requires frontend deps installed)
npm run build:frontend

# Build both (backend + frontend)
npm run build:all
```

### 3. Testing & Quality Assurance

```bash
# Run all tests (uses Vitest, ~31 tests)
npm run test

# Run linting (comprehensive - JSON, JS/TS, Markdown, spelling)
npm run lint

# Fix auto-fixable issues
npm run fix
```

### 4. Development Server

```bash
# Start backend on port 3000
npm start

# Start backend on port 4000 (avoids frontend conflicts)
npm run start-4000

# For container deployment use only
npm run start-in-container
```

## Critical Build Issues & Workarounds

### NPM Configuration Files

**NEVER modify:** `.npmrc` or `.npmrc.arg` files - these contain Microsoft-internal Azure Artifacts configuration and do not need agent updates

### Common Build Failures

1. **"spawn vite ENOENT"** → Run `npm install && pushd frontend && npm install && popd`
2. **TypeScript errors** → Ensure Node.js 20+ installed
3. **Frontend build fails** → Skip with backend-only commands if no frontend changes

## Project Architecture & Key Directories

### Root Level Structure

```text
├── .github/          # GitHub workflows and configuration
├── .environment/     # Microsoft-internal config-as-code
├── business/         # Core business logic layer
├── config/           # Application configuration system
├── frontend/         # React frontend application
├── interfaces/       # TypeScript interfaces/types
├── jobs/             # Background job implementations
├── lib/              # Shared utility libraries
├── microsoft/        # Microsoft-specific internal code
├── middleware/       # Express middleware components
├── routes/           # API and web route handlers
├── scripts/          # Administrative and maintenance scripts
└── views/            # Server-side web and email templates (Pug)
```

### Important Configuration Files

- `package.json` - Backend dependencies and scripts
- `.environment/env/production.jsonc` - Maps most runtime configuration values into the environment at startup
- `tsconfig.json` - TypeScript compiler configuration
- `eslint.config.mjs` - Linting rules and ignores
- `vitest.config.ts` - Test configuration
- `.cspell.json` - Spell check dictionary and rules - though `@cspell ignore` commands are often used for Microsoft-specific single file terms

### Microsoft-Internal Directories

- `.environment/` - Config-as-code for different environments
- `microsoft/` - Internal-only business logic and backend integrations
- `api/` - Exposed APIs for server-to-server calls
- `microsoft/api/` - Exposed internal Microsoft-only APIs for server-to-server calls
- `frontend/src/microsoft/` - Internal-only frontend logic and interface
- `.github/workflows/` - Microsoft-specific CI/CD pipelines

## Development Workflow Best Practices

### Making Code Changes

1. **Always run linting first:** `npm run lint`
2. **Build incrementally:** Use `npm run build` for backend-only changes
3. **Test frequently:** `npm run test` - all tests should pass

### Frontend Development

- Frontend uses Vite with hot reload
- Located in `frontend/` with separate `package.json`
- Requires Microsoft-internal packages for full builds
- For UI changes, focus on `frontend/src/` directory

### Common Pitfalls

- **Don't modify NPM config files** (`.npmrc`, `.npmrc.arg`)
- **Always lint before committing** - CI will fail on lint issues
- **Use absolute paths** when referencing files in automation
- **Check both backend and frontend** for full-stack changes

## Running Background Jobs & Scripts

### Job Execution

```bash
# Individual jobs are in jobs/ directory
node ./dist/jobs/[job-name]/index.js

# Scripts for maintenance tasks
node ./dist/scripts/[script-name].js
```

### Database & External Dependencies

- Postgres is the source of truth for much data, abstracted through a complex "entity metadata" implementation to make it agnostic
- Uses CosmosDB for cache layer through a generalized ICacheProvider interface
- Providers (ICorporateProviders and IProviders) are central inversion of control access points for most runtime providers
- GitHub Apps often use Azure Key Vault and remote key signing
- Azure Services integration for Microsoft deployment

## Testing Strategy

### Test Structure

- **Unit tests:** `*.test.ts` files using Vitest
- **Test coverage:** Business logic, configuration, core utilities
- **Mock data:** Test fixtures in `lib/test/` directory

### Running Specific Tests

```bash
# Run all tests
npm run test
```

## Troubleshooting Common Issues

### Build Issues

- **TypeScript compilation fails:** Check Node.js version (requires 20+)
- **Frontend authentication errors:** Expected for external contributors, use backend-only builds
- **Circular dependencies:** `npm run find-circular-dependencies` requires Azure Artifacts access
- **Dead code detection:** `npm run find-deadcode` works (uses ts-prune)

### Development Environment

- **Local development:** Requires extensive environment configuration
- **Codespaces support:** Built-in dev container configuration available
- **Docker deployment:** Use provided Dockerfile for containerization

### Performance & Scale

- Application handles 68,000+ user scale
- Background jobs run on schedules for data consistency
- Extensive caching layer for GitHub API efficiency
- Rate limiting considerations for GitHub API usage. Move low and slow on jobs using GitHub - sleeps, no parallel work in the same org, etc., just to lighten the load.

---

**Trust these instructions** - they reflect the current state of the repository. Only search for additional information if these instructions are incomplete or appear incorrect for your specific task.
