import { db } from './index';
import { venues } from './schema/venues';

export async function seedDatabase() {
  console.log('🌱 Seeding database...');

  try {
    // Insert initial venues
    const initialVenues = [
      {
        id: 'venue_1',
        name: 'David Lloyd Raynes Park',
        slug: 'david-lloyd-raynes-park',
        platform: 'clubspark',
        baseUrl: 'https://clubspark.lta.org.uk/DavidLloydRaynesPark',
        isActive: true,
        scrapingEnabled: true,
      },
      {
        id: 'venue_2', 
        name: 'Raynes Park Tennis Club',
        slug: 'raynes-park-tennis-club',
        platform: 'clubspark',
        baseUrl: 'https://clubspark.lta.org.uk/RaynesParkTC',
        isActive: true,
        scrapingEnabled: true,
      },
      {
        id: 'venue_3',
        name: 'Wimbledon Park Tennis Club',
        slug: 'wimbledon-park-tennis-club', 
        platform: 'courtside',
        baseUrl: 'https://wimbledonparktc.com',
        isActive: true,
        scrapingEnabled: true,
      },
    ];

    // Insert venues
    for (const venue of initialVenues) {
      await db.insert(venues).values(venue).onConflictDoNothing();
    }

    console.log('✅ Database seeded successfully');
  } catch (error) {
    console.error('❌ Error seeding database:', error);
    throw error;
  }
}

// Run seed if called directly
if (require.main === module) {
  seedDatabase()
    .then(() => {
      console.log('Seeding completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Seeding failed:', error);
      process.exit(1);
    });
}

