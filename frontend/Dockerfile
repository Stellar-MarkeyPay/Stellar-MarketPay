FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN corepack enable && pnpm install --frozen-lockfile

FROM node:20-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ARG NEXT_PUBLIC_BASE_URL=http://localhost:3000
ARG NEXT_PUBLIC_STELLAR_NETWORK=testnet
ARG NEXT_PUBLIC_HORIZON_URL=https://horizon-testnet.stellar.org
ARG NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
ARG NEXT_PUBLIC_CONTRACT_ID=CMOCKCONTRACTID
ARG NEXT_PUBLIC_USE_CONTRACT_MOCK=true

ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_BASE_URL=${NEXT_PUBLIC_BASE_URL}
ENV NEXT_PUBLIC_STELLAR_NETWORK=${NEXT_PUBLIC_STELLAR_NETWORK}
ENV NEXT_PUBLIC_HORIZON_URL=${NEXT_PUBLIC_HORIZON_URL}
ENV NEXT_PUBLIC_SOROBAN_RPC_URL=${NEXT_PUBLIC_SOROBAN_RPC_URL}
ENV NEXT_PUBLIC_CONTRACT_ID=${NEXT_PUBLIC_CONTRACT_ID}
ENV NEXT_PUBLIC_USE_CONTRACT_MOCK=${NEXT_PUBLIC_USE_CONTRACT_MOCK}

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.mjs ./next.config.mjs

EXPOSE 3000
CMD ["pnpm", "run", "start"]
