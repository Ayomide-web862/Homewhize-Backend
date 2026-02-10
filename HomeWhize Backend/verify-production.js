#!/usr/bin/env node

/**
 * HomeWhize Backend - Production Verification Script
 * Checks database connection, tables, and API endpoints
 * Run: node verify-production.js
 */

import db from "./config/db.js";
import dotenv from "dotenv";

dotenv.config();

const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
};

function log(message, color = "reset") {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function checkDatabase() {
  return new Promise((resolve) => {
    log("\n📊 Checking Database Connection...", "blue");
    
    db.query("SELECT 1", (err) => {
      if (err) {
        log("❌ Database connection failed:", "red");
        log(`   Error: ${err.message}`, "red");
        resolve(false);
      } else {
        log("✅ Database connection successful", "green");
        resolve(true);
      }
    });
  });
}

async function checkTables() {
  return new Promise((resolve) => {
    const requiredTables = [
      "users",
      "properties",
      "property_images",
      "bookings",
      "community_posts",
      "community_post_images",
      "community_comments",
      "community_likes",
      "kyc_requests",
    ];

    log("\n📋 Checking Database Tables...", "blue");

    db.query(
      "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE()",
      (err, tables) => {
        if (err) {
          log("❌ Could not check tables:", "red");
          log(`   Error: ${err.message}`, "red");
          resolve(false);
          return;
        }

        const existingTables = tables.map((t) => t.TABLE_NAME);
        let allExists = true;

        requiredTables.forEach((table) => {
          if (existingTables.includes(table)) {
            log(`   ✅ ${table}`, "green");
          } else {
            log(`   ❌ ${table} (MISSING)`, "red");
            allExists = false;
          }
        });

        if (allExists) {
          log("✅ All required tables exist", "green");
        } else {
          log("❌ Some tables are missing. Import chuttlers.sql", "red");
        }

        resolve(allExists);
      }
    );
  });
}

async function checkEnvironment() {
  log("\n🔧 Checking Environment Configuration...", "blue");

  const required = [
    "DB_HOST",
    "DB_USER",
    "DB_NAME",
    "JWT_SECRET",
    "FRONTEND_URLS",
    "EMAIL_USER",
  ];

  let allConfigured = true;

  required.forEach((key) => {
    if (process.env[key]) {
      log(`   ✅ ${key}`, "green");
    } else {
      log(`   ❌ ${key} (MISSING)`, "red");
      allConfigured = false;
    }
  });

  if (allConfigured) {
    log("✅ All environment variables configured", "green");
  } else {
    log("❌ Some environment variables are missing. Check .env file", "red");
  }

  return allConfigured;
}

async function checkDatabasePermissions() {
  return new Promise((resolve) => {
    log("\n🔐 Checking Database Permissions...", "blue");

    // Try to insert and delete (should succeed)
    db.query("CREATE TEMPORARY TABLE perm_test AS SELECT 1", (err) => {
      if (err) {
        log("❌ Database write permissions denied", "red");
        log(`   Error: ${err.message}`, "red");
        resolve(false);
      } else {
        log("✅ Database read/write permissions OK", "green");
        resolve(true);
      }
    });
  });
}

async function runAllChecks() {
  log("\n" + "=".repeat(50), "blue");
  log("HomeWhize Backend - Production Verification", "blue");
  log("=".repeat(50), "blue");

  const envOk = await checkEnvironment();
  const dbConnected = await checkDatabase();
  const tablesOk = await checkTables();
  const permissionsOk = await checkDatabasePermissions();

  log("\n" + "=".repeat(50), "blue");
  log("Verification Summary", "blue");
  log("=".repeat(50), "blue");

  const allOk = envOk && dbConnected && tablesOk && permissionsOk;

  if (allOk) {
    log("\n✅ All checks passed! System is ready for production.", "green");
    log("\nYou can now:", "green");
    log("  1. Start the server: npm start", "green");
    log("  2. Test endpoints: curl https://your-domain/api/", "green");
    log("  3. Monitor logs: npm start", "green");
  } else {
    log("\n❌ Some checks failed. Please review the errors above.", "red");
    log("\nCommon fixes:", "yellow");
    log("  - Check .env file configuration", "yellow");
    log("  - Verify MySQL user permissions", "yellow");
    log("  - Import database schema: mysql < chuttlers.sql", "yellow");
    log("  - Ensure all tables exist", "yellow");
  }

  process.exit(allOk ? 0 : 1);
}

runAllChecks().catch((err) => {
  log(`\nFatal error: ${err.message}`, "red");
  process.exit(1);
});
