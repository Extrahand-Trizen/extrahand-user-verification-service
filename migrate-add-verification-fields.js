/**
 * Migration Script: Add new fields to existing verification records
 * 
 * Purpose:
 * - Add verificationSource field (default: 'self_service_api' for existing records)
 * - Add updateHistory array (empty for existing records)
 * - Add verifiedBy field (null for existing records)
 * - Update provider enum to include 'admin_manual' and 'admin_bulk'
 * 
 * Run this BEFORE deploying the new code to production
 * 
 * Usage:
 *   node migrate-add-verification-fields.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Verification = require('./models/Verification');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/extrahand_verifications';

async function migrate() {
  try {
    console.log('🔄 Starting migration...\n');
    console.log('📊 Connecting to MongoDB:', MONGODB_URI.replace(/\/\/.*@/, '//***@'));
    
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // Get all verification records
    const verifications = await Verification.find({});
    console.log(`📦 Found ${verifications.length} verification records\n`);

    if (verifications.length === 0) {
      console.log('✅ No records to migrate. Database is ready!');
      await mongoose.disconnect();
      return;
    }

    let updated = 0;
    let skipped = 0;
    let errors = 0;

    console.log('🔄 Processing records...\n');

    for (const verification of verifications) {
      try {
        let needsUpdate = false;
        const updates = {};

        // Add verificationSource if missing
        if (!verification.verificationSource) {
          // Determine source based on existing provider
          // Note: admin_bulk is removed - all admin verifications are now admin_manual
          if (verification.provider === 'admin_activation' || verification.provider === 'admin_bulk_upload' || verification.provider === 'admin_bulk') {
            updates.verificationSource = 'admin_manual';
          } else if (verification.provider === 'admin_manual') {
            updates.verificationSource = 'admin_manual';
          } else {
            updates.verificationSource = 'self_service_api';
          }
          needsUpdate = true;
        }
        
        // Convert admin_bulk source to admin_manual (admin_bulk is deprecated)
        if (verification.verificationSource === 'admin_bulk') {
          updates.verificationSource = 'admin_manual';
          needsUpdate = true;
        }

        // Add updateHistory if missing
        if (!verification.updateHistory) {
          updates.updateHistory = [];
          needsUpdate = true;
        }

        // Normalize provider value if it's the old 'admin_activation' or 'admin_bulk'
        if (verification.provider === 'admin_activation' || verification.provider === 'admin_bulk_upload' || verification.provider === 'admin_bulk') {
          updates.provider = 'admin_manual';
          needsUpdate = true;
        }

        if (needsUpdate) {
          await Verification.updateOne(
            { _id: verification._id },
            { $set: updates }
          );
          updated++;
          console.log(`  ✅ Updated: ${verification._id} (${verification.type} for user ${verification.userId})`);
        } else {
          skipped++;
          console.log(`  ⏭️  Skipped: ${verification._id} (already has new fields)`);
        }
      } catch (error) {
        errors++;
        console.error(`  ❌ Error updating ${verification._id}:`, error.message);
      }
    }

    console.log('\n📊 Migration Summary:');
    console.log(`  Total records: ${verifications.length}`);
    console.log(`  ✅ Updated: ${updated}`);
    console.log(`  ⏭️  Skipped: ${skipped}`);
    console.log(`  ❌ Errors: ${errors}`);

    // Check for duplicates that will violate the unique index
    console.log('\n🔍 Checking for duplicate records (userId + type)...\n');
    
    const duplicates = await Verification.aggregate([
      {
        $group: {
          _id: { userId: '$userId', type: '$type' },
          count: { $sum: 1 },
          ids: { $push: '$_id' }
        }
      },
      {
        $match: {
          count: { $gt: 1 }
        }
      }
    ]);

    if (duplicates.length > 0) {
      console.log(`⚠️  WARNING: Found ${duplicates.length} duplicate records!\n`);
      console.log('These records will prevent the unique index from being created:');
      
      for (const dup of duplicates) {
        console.log(`\n  User: ${dup._id.userId}, Type: ${dup._id.type}`);
        console.log(`  Count: ${dup.count} records`);
        console.log(`  IDs: ${dup.ids.join(', ')}`);
        
        // Show details of each duplicate
        const dupRecords = await Verification.find({ 
          userId: dup._id.userId, 
          type: dup._id.type 
        }).sort({ verifiedAt: -1 });
        
        dupRecords.forEach((record, index) => {
          console.log(`    ${index + 1}. ${record._id} - ${record.status} - ${record.verifiedAt?.toISOString() || 'No date'} - Source: ${record.verificationSource || 'unknown'}`);
        });
      }

      console.log('\n📋 MANUAL ACTION REQUIRED:');
      console.log('You need to manually resolve these duplicates before creating the unique index.');
      console.log('Options:');
      console.log('  1. Delete older records, keeping the most recent');
      console.log('  2. Merge records by moving data to updateHistory');
      console.log('  3. Contact the development team for assistance\n');
      console.log('💡 Suggested MongoDB command to keep latest and delete older:');
      console.log('   (Run in MongoDB shell after reviewing the data)\n');
      
      for (const dup of duplicates) {
        const dupRecords = await Verification.find({ 
          userId: dup._id.userId, 
          type: dup._id.type 
        }).sort({ verifiedAt: -1 });
        
        const idsToDelete = dupRecords.slice(1).map(r => `ObjectId("${r._id}")`);
        console.log(`db.verifications.deleteMany({ _id: { $in: [${idsToDelete.join(', ')}] }})`);
      }
      
      console.log('\n⚠️  Do NOT create the unique index until duplicates are resolved!\n');
    } else {
      console.log('✅ No duplicate records found! Safe to create unique index.\n');
      
      // Try to create the unique index
      console.log('🔄 Creating unique index on (userId, type)...');
      try {
        await Verification.collection.createIndex(
          { userId: 1, type: 1 }, 
          { unique: true }
        );
        console.log('✅ Unique index created successfully!\n');
      } catch (indexError) {
        console.error('❌ Failed to create unique index:', indexError.message);
        console.log('You may need to drop existing index first:');
        console.log('  db.verifications.dropIndex("userId_1_type_1")\n');
      }
    }

    console.log('✅ Migration completed!\n');
    await mongoose.disconnect();
    console.log('📊 Disconnected from MongoDB\n');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run migration
if (require.main === module) {
  migrate().then(() => {
    console.log('🎉 All done!');
    process.exit(0);
  }).catch(error => {
    console.error('💥 Fatal error:', error);
    process.exit(1);
  });
}

module.exports = migrate;
