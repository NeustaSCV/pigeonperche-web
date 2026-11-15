# Pigeon perché : image en deux étapes. La première construit le site (Node + Vite), la seconde ne garde que dist/
# et le petit serveur sans dépendance (server/), lancé par un utilisateur non privilégié.
#   docker build -t pigeon-perche .
#   docker run -d -p 8080:8080 -v pigeon-scores:/data pigeon-perche

# L'étape de construction tourne sur l'architecture de la machine qui construit (dist/ ne dépend pas de l'architecture) :
# construire sur un Mac pour un serveur x86 reste rapide.
FROM --platform=$BUILDPLATFORM node:24-alpine AS build
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
# `npm install` et non `npm ci` : le fichier de verrouillage, produit sur macOS, n'énumère pas toutes les dépendances
# optionnelles propres à Linux (binaires de Rolldown) ; `npm ci` le refuse, `npm install` respecte les versions verrouillées
RUN npm install --no-audit --no-fund
COPY index.html tsconfig.json vite.config.ts ./
COPY public ./public
COPY server ./server
COPY src ./src
COPY tests ./tests
RUN npm run build

FROM node:24-alpine
ENV NODE_ENV=production \
    PORT=8080 \
    DIST_DIR=/app/dist \
    SCORES_FILE=/data/scores.json
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY server ./server
# cœur du classement, partagé avec le jeu : seul fichier de src/ dont le serveur a besoin
COPY src/shared/scores-core.mjs ./src/shared/scores-core.mjs
# le fichier des scores vit dans un volume, inscriptible par l'utilisateur « node » (non privilégié) de l'image
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8080) + '/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "server/server.mjs"]
