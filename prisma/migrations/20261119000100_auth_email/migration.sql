-- AlterTable
ALTER TABLE `User`
  ADD COLUMN `emailVerified` DATETIME(3) NULL,
  ADD COLUMN `verificationToken` VARCHAR(191) NULL,
  ADD COLUMN `verificationExpires` DATETIME(3) NULL,
  ADD COLUMN `passwordResetToken` VARCHAR(191) NULL,
  ADD COLUMN `passwordResetExpires` DATETIME(3) NULL;

-- Akun yang sudah ada dianggap terverifikasi agar tidak terkunci.
UPDATE `User` SET `emailVerified` = CURRENT_TIMESTAMP(3) WHERE `emailVerified` IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX `User_verificationToken_key` ON `User`(`verificationToken`);
CREATE UNIQUE INDEX `User_passwordResetToken_key` ON `User`(`passwordResetToken`);
