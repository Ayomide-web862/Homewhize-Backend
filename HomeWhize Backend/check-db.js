import db from './config/db.js';

async function checkDB() {
  try {
    console.log('=== DATABASE CHECK ===');

    // Check properties
    const [props] = await db.execute('SELECT id, name FROM properties ORDER BY id DESC LIMIT 3');
    console.log(`Found ${props.length} properties:`);
    props.forEach(p => console.log(`  - ID: ${p.id}, Name: ${p.name}`));

    // Check property_images
    const [images] = await db.execute('SELECT property_id, LEFT(image_url, 50) as url_preview FROM property_images ORDER BY id DESC LIMIT 5');
    console.log(`Found ${images.length} images:`);
    images.forEach(img => console.log(`  - Property ${img.property_id}: ${img.url_preview}...`));

    // Check relationship
    const [stats] = await db.execute(`
      SELECT p.name, COUNT(pi.id) as image_count
      FROM properties p
      LEFT JOIN property_images pi ON p.id = pi.property_id
      GROUP BY p.id
      ORDER BY p.id DESC
      LIMIT 3
    `);
    console.log('Property-image relationship:');
    stats.forEach(stat => console.log(`  - ${stat.name}: ${stat.image_count} images`));

    console.log('=== CHECK COMPLETE ===');
    process.exit(0);
  } catch (err) {
    console.error('Database check failed:', err.message);
    process.exit(1);
  }
}

checkDB();