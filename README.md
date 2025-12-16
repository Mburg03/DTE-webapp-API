# Factura Automate
Plataforma que conecta Gmail, busca facturas (PDF/JSON) con keywords en el asunto, las descarga, evita duplicados y arma paquetes ZIP listos para enviar al contador. Guarda metadatos y roles en MongoDB y sube los ZIP a S3.

## Qué resuelve
- Elimina horas de descarga manual de facturas del correo.
- Evita olvidos y duplicados (mismo adjunto o mismo nombre dentro del correo).
- Genera carpetas ordenadas: por correo (JSON_y_PDFS) y plano de PDFs (SOLO_PDF).
- Historial de paquetes descargables (S3) y últimas ejecuciones visibles en el dashboard.
- Soporta roles: viewer (solo lectura), basic (usa Gmail/paquetes), admin (gestiona usuarios/roles).

## Stack
- Backend: Node.js + Express, MongoDB Atlas, Google Gmail API (OAuth2), AWS S3 para ZIPs.
- Frontend: React (Vite) + Tailwind + Axios + React Router.
- Autenticación: JWT. Tokens Gmail cifrados (ENCRYPTION_KEY).
- Otros: Nodemon para dev, dotenv para env, Archiver para ZIPs.

## Estructura
- `backend/` API y servicios (OAuth, búsqueda, ZIP, S3, keywords, roles, admin, reset password).
- `frontend/` SPA (login/register/forgot/reset, dashboard, packages, settings, admin users).

## Requisitos
- Node.js 18+
- MongoDB Atlas (recomendado)
- Google Cloud: proyecto con Gmail API, OAuth consent y cliente Web.
- AWS S3: bucket, keys con permisos de Put/Get y bucket policy acorde.

## Variables de entorno
Backend (`backend/.env`):
```
PORT=5001
MONGO_URI=.....
JWT_SECRET=clave_larga
ENCRYPTION_KEY=32_caracteres_exactos
CORS_ORIGIN=http://localhost:5173
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:5001/api/gmail/callback
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
AWS_S3_BUCKET=dte-zips
FRONTEND_URL=http://localhost:5173
# opcional
GOOGLE_API_TIMEOUT_MS=60000
```

Frontend (`frontend/.env`):
```
VITE_API_URL=http://localhost:5001/api
```

## Setup rápido
Backend:
```
cd backend
npm install
npm run dev    # nodemon
# producción local:
# npm run build (si aplica) && npm start
```

Frontend:
```
cd frontend
npm install
npm run dev    # http://localhost:5173
# producción:
# npm run build && npm run preview
```

## Flujo principal (usuario basic/admin)
1) Registrarse (pide nombre, email, contraseña, DUI) y login. El rol por defecto es viewer; un admin puede cambiarlo a basic.
2) Conectar Gmail desde el dashboard (botón abre OAuth). Guardamos refresh token cifrado.
3) Buscar facturas por rango de fechas: combina keywords base + custom. Trae PDFs/JSON, deduplica por attachmentId y por nombre de PDF dentro del mismo correo.
4) Genera ZIP con estructura:
   - `JSON_y_PDFS/<correo>` con PDFs/JSON por email
   - `SOLO_PDF/` con todos los PDFs planos
   - `INFO.txt` con rango, correo conectado y fecha de generación
5) Sube el ZIP a S3. Guarda metadatos en MongoDB (pdfCount, jsonCount, size, storageKey, batchLabel). Descarga vía URL firmada.

## Rutas clave (resumen)
- Auth: login/register/me/logout, forgot/reset password.
- Gmail: status, auth URL, callback, disconnect, search.
- Keywords: listar base+custom, agregar/eliminar custom.
- Packages: generar, listar, último, descargar (S3 signed URL).
- Admin: listar usuarios con stats, ver detalle, reset password, cambiar rol, eliminar usuario.

## Notas de operación
- No subas `.env`, `uploads/`, `node_modules/`, ni builds al repo.
- Ajusta `maxResults`/concurrencia en `gmailService` si necesitas más o menos velocidad.
- S3: el nombre del ZIP usa el batch label (ej. `2025-12.zip`); se limpia el temporal local tras subir.
- Viewer no puede buscar ni generar; basic/admin sí. Admin ve la página de Administración de Usuarios en el frontend.

## Demo rápida para un cliente (local)
- Backend en `:5001`, frontend en `:5173`.
- En MongoDB Atlas, permite tu IP temporalmente para la demo.
- En Google Cloud, añade al menos tu correo como Test User del OAuth consent.
- Revisa que las variables de AWS S3 y Gmail estén cargadas antes de probar generación/descarga.
