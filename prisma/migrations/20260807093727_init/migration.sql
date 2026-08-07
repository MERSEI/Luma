-- CreateEnum
CREATE TYPE "AgeGateStatus" AS ENUM ('unknown', 'confirmed_adult', 'declined');

-- CreateEnum
CREATE TYPE "Tone" AS ENUM ('warm', 'playful', 'calm', 'witty');

-- CreateEnum
CREATE TYPE "ConversationMode" AS ENUM ('friendly', 'story', 'language_practice', 'creative');

-- CreateEnum
CREATE TYPE "ConsentType" AS ENUM ('disclosure', 'memory', 'age_18plus', 'media');

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('user', 'assistant', 'system');

-- CreateEnum
CREATE TYPE "Modality" AS ENUM ('text', 'voice', 'image', 'video');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('ok', 'refused', 'failed');

-- CreateEnum
CREATE TYPE "MemoryCategory" AS ENUM ('profile', 'preferences', 'episodic_summary');

-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('message_pack', 'theme_pack', 'customization', 'memory_plus');

-- CreateEnum
CREATE TYPE "EntitlementKind" AS ENUM ('trial', 'purchased');

-- CreateEnum
CREATE TYPE "EntitlementStatus" AS ENUM ('active', 'exhausted', 'expired', 'refunded');

-- CreateEnum
CREATE TYPE "LedgerEventType" AS ENUM ('trial_grant', 'purchase_credit', 'debit', 'refund_reversal', 'admin_adjustment');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('succeeded', 'refunded');

-- CreateEnum
CREATE TYPE "ModerationDirection" AS ENUM ('input', 'output');

-- CreateEnum
CREATE TYPE "ModerationAction" AS ENUM ('allow', 'refuse', 'escalate', 'block');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "telegramUserId" BIGINT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'ru',
    "ageGateStatus" "AgeGateStatus" NOT NULL DEFAULT 'unknown',
    "disclosureAcceptedAt" TIMESTAMP(3),
    "blockedAt" TIMESTAMP(3),
    "bannedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Profile" (
    "userId" UUID NOT NULL,
    "displayName" TEXT,
    "timezone" TEXT,
    "companionName" TEXT NOT NULL DEFAULT 'Luma',
    "tone" "Tone" NOT NULL DEFAULT 'warm',
    "interests" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "boundaries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "mode" "ConversationMode" NOT NULL DEFAULT 'friendly',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Profile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "Consent" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "ConsentType" NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Consent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "mode" "ConversationMode" NOT NULL DEFAULT 'friendly',
    "summary" TEXT,
    "summaryAtMessageNo" INTEGER NOT NULL DEFAULT 0,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "modality" "Modality" NOT NULL DEFAULT 'text',
    "status" "MessageStatus" NOT NULL DEFAULT 'ok',
    "model" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "costUsd" DECIMAL(12,8),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemoryItem" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "category" "MemoryCategory" NOT NULL,
    "content" TEXT NOT NULL,
    "consentVersion" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "expiresAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "type" "ProductType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priceXtr" INTEGER NOT NULL,
    "priceVersion" INTEGER NOT NULL DEFAULT 1,
    "grantsMessages" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Entitlement" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "kind" "EntitlementKind" NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "status" "EntitlementStatus" NOT NULL DEFAULT 'active',
    "sourcePaymentId" UUID,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Entitlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "entitlementId" UUID,
    "eventType" "LedgerEventType" NOT NULL,
    "delta" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "telegramChargeId" TEXT NOT NULL,
    "providerChargeId" TEXT,
    "sku" TEXT NOT NULL,
    "amountXtr" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'XTR',
    "status" "PaymentStatus" NOT NULL DEFAULT 'succeeded',
    "invoicePayload" TEXT NOT NULL,
    "rawPayloadHash" TEXT NOT NULL,
    "refundedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessedUpdate" (
    "updateId" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedUpdate_pkey" PRIMARY KEY ("updateId")
);

-- CreateTable
CREATE TABLE "ModerationEvent" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "direction" "ModerationDirection" NOT NULL,
    "category" TEXT NOT NULL,
    "action" "ModerationAction" NOT NULL,
    "messageId" UUID,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModerationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" UUID NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsEvent" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "event" TEXT NOT NULL,
    "props" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_telegramUserId_key" ON "User"("telegramUserId");

-- CreateIndex
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");

-- CreateIndex
CREATE INDEX "Consent_userId_type_idx" ON "Consent"("userId", "type");

-- CreateIndex
CREATE INDEX "Conversation_userId_updatedAt_idx" ON "Conversation"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "MemoryItem_userId_deletedAt_expiresAt_idx" ON "MemoryItem"("userId", "deletedAt", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");

-- CreateIndex
CREATE INDEX "Entitlement_userId_status_idx" ON "Entitlement"("userId", "status");

-- CreateIndex
CREATE INDEX "Entitlement_userId_kind_expiresAt_idx" ON "Entitlement"("userId", "kind", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_idempotencyKey_key" ON "LedgerEntry"("idempotencyKey");

-- CreateIndex
CREATE INDEX "LedgerEntry_userId_createdAt_idx" ON "LedgerEntry"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_entitlementId_idx" ON "LedgerEntry"("entitlementId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_telegramChargeId_key" ON "Payment"("telegramChargeId");

-- CreateIndex
CREATE INDEX "Payment_userId_createdAt_idx" ON "Payment"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ProcessedUpdate_createdAt_idx" ON "ProcessedUpdate"("createdAt");

-- CreateIndex
CREATE INDEX "ModerationEvent_userId_createdAt_idx" ON "ModerationEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ModerationEvent_category_createdAt_idx" ON "ModerationEvent"("category", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_action_createdAt_idx" ON "AuditEvent"("action", "createdAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_event_createdAt_idx" ON "AnalyticsEvent"("event", "createdAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_userId_createdAt_idx" ON "AnalyticsEvent"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consent" ADD CONSTRAINT "Consent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryItem" ADD CONSTRAINT "MemoryItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Entitlement" ADD CONSTRAINT "Entitlement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_entitlementId_fkey" FOREIGN KEY ("entitlementId") REFERENCES "Entitlement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationEvent" ADD CONSTRAINT "ModerationEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
