# ARCHITECTURE NOTICE: Inactive Migration Prototype

> **STATUS**: **INACTIVE / DEPRECATED PROTOTYPE**  
> **PRODUCTION SOURCE OF TRUTH**: **Firebase (Firestore, Firebase Auth, Firebase Storage)**

---

### Architectural Clarification
The contents of this `/backend` directory (including the Next.js server and Prisma/PostgreSQL schema) represent an experimental migration prototype and are **NOT used in production**.

1. **Authentication**: Handled exclusively via **Firebase Auth** (`src/firebase.ts`).
2. **Database**: Handled exclusively via **Cloud Firestore** (`src/firebase.ts`).
3. **File Storage**: Handled exclusively via **Firebase Storage** (`storage.rules`).
4. **AI Gateway**: Handled via serverless API routes (`api/ai.ts`).

Do not query, seed, or migrate data against PostgreSQL or Prisma for production features. All active client features interact directly with Firebase services.
