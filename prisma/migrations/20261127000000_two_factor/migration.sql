-- AlterTable
ALTER TABLE `User` ADD COLUMN `twoFactorEnabled` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `twoFactorPendingSecret` VARCHAR(512) NULL,
    ADD COLUMN `twoFactorSecret` VARCHAR(512) NULL;

-- CreateTable
CREATE TABLE `TwoFactorRecovery` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `codeHash` VARCHAR(64) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `TwoFactorRecovery_userId_usedAt_idx`(`userId`, `usedAt`),
    UNIQUE INDEX `TwoFactorRecovery_userId_codeHash_key`(`userId`, `codeHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `TwoFactorRecovery` ADD CONSTRAINT `TwoFactorRecovery_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
