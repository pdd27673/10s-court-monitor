import { getDb } from './index';
import { venues } from './schema/venues';

export async function seedDatabase() {
  console.log('🌱 Seeding database...');

  try {
    // Insert initial venues based on real Tower Hamlets tennis courts
    const initialVenues = [
      {
        id: 'venue_victoria_park',
        name: 'Victoria Park',
        slug: 'victoria-park',
        platform: 'courtsides',
        baseUrl: 'https://tennistowerhamlets.com/book/courts/victoria-park#book',
        isActive: true,
        scrapingEnabled: true,
      },
      {
        id: 'venue_stratford_park',
        name: 'Stratford Park',
        slug: 'stratford-park',
        platform: 'lta_clubspark',
        baseUrl: 'https://stratford.newhamparkstennis.org.uk/Booking/BookByDate#?date=2025-06-09&role=guest',
        isActive: true,
        scrapingEnabled: true,
      },
      {
        id: 'venue_ropemakers_field',
        name: 'Ropemakers Field',
        slug: 'ropemakers-field',
        platform: 'courtsides',
        baseUrl: 'https://tennistowerhamlets.com/book/courts/ropemakers-field#book',
        isActive: true,
        scrapingEnabled: true,
      },
      {
        id: 'venue_bethnal_green',
        name: 'Bethnal Green Gardens',
        slug: 'bethnal-green-gardens',
        platform: 'courtsides',
        baseUrl: 'https://tennistowerhamlets.com/book/courts/bethnal-green-gardens#book',
        isActive: true,
        scrapingEnabled: true,
      },
      {
        id: 'venue_st_johns_park',
        name: 'St Johns Park',
        slug: 'st-johns-park',
        platform: 'courtsides',
        baseUrl: 'https://tennistowerhamlets.com/book/courts/st-johns-park#book',
        isActive: true,
        scrapingEnabled: true,
      },
      {
        id: 'venue_king_edward_memorial',
        name: 'King Edward Memorial Park',
        slug: 'king-edward-memorial-park',
        platform: 'courtsides',
        baseUrl: 'https://tennistowerhamlets.com/book/courts/king-edward-memorial-park#book',
        isActive: true,
        scrapingEnabled: true,
      },
      {
        id: 'venue_poplar_rec',
        name: 'Poplar Rec Ground',
        slug: 'poplar-rec-ground',
        platform: 'courtsides',
        baseUrl: 'https://tennistowerhamlets.com/book/courts/poplar-rec-ground#book',
        isActive: true,
        scrapingEnabled: true,
      },
    ];

    // Insert venues
    const db = getDb();
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

