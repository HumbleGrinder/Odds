const fetch = require('node-fetch');
const admin = require('firebase-admin');

// Initialize Firebase
const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://odds-32154-default-rtdb.firebaseio.com"
});

const db = admin.database();

// Category mapping: Polymarket slug → Firebase path
const categories = [
  { slug: 'oscars-2026-best-picture-winner', path: 'oscars/best-picture' },
  { slug: 'oscars-2026-best-director-winner', path: 'oscars/best-director' },
  { slug: 'oscars-2026-best-actor-winner', path: 'oscars/best-actor' },
  { slug: 'oscars-2026-best-actress-winner', path: 'oscars/best-actress' },
  { slug: 'oscars-2026-best-supporting-actor-winner', path: 'oscars/best-supporting-actor' },
  { slug: 'oscars-2026-best-supporting-actress-winner', path: 'oscars/best-supporting-actress' }
];

// Convert probability to American odds
function probToAmericanOdds(probability) {
  const prob = parseFloat(probability);
  if (prob >= 0.5) {
    const odds = Math.round(-(prob * 100) / (1 - prob));
    return `${odds}`;
  } else {
    const odds = Math.round(((1 - prob) * 100) / prob);
    return `+${odds}`;
  }
}

// Fetch Polymarket data for a category
async function fetchPolymarketData(slug) {
  try {
    const url = `https://gamma-api.polymarket.com/events?slug=${slug}`;
    const response = await fetch(url);
    const data = await response.json();
    
    if (!data || data.length === 0) {
      console.log(`No data found for ${slug}`);
      return [];
    }
    
    const nominees = event.markets.map(market => {
      // Parse outcomePrices - it's a JSON string like "[\"0.745\", \"0.255\"]"
      const prices = JSON.parse(market.outcomePrices);
      const probability = prices[0]; // First outcome is "Yes" (will win)
      
      return {
        name: market.groupItemTitle,
        probability: probability,
        odds: probToAmericanOdds(probability)
      };
    }).filter(n => n.name); // Filter out entries without names (like "Movie D", "Other")
        
    return nominees;
  } catch (error) {
    console.error(`Error fetching ${slug}:`, error.message);
    return [];
  }
}

// Update Firebase with Polymarket odds
async function updateCategory(category) {
  console.log(`\nUpdating ${category.path}...`);
  
  // Fetch Polymarket data
  const polymarketData = await fetchPolymarketData(category.slug);
  if (polymarketData.length === 0) {
    console.log(`Skipping ${category.path} - no Polymarket data`);
    return;
  }
  
  console.log(`Found ${polymarketData.length} nominees on Polymarket`);
  
  // Get current Firebase data
  const ref = db.ref(`${category.path}/nominees`);
  const snapshot = await ref.once('value');
  const firebaseNominees = snapshot.val() || [];
  
  if (firebaseNominees.length === 0) {
    console.log(`No nominees in Firebase for ${category.path}`);
    return;
  }
  
  // Update each nominee's Polymarket odds
  let updatedCount = 0;
  const updatedNominees = firebaseNominees.map(nominee => {
    const polymarketNominee = polymarketData.find(p => p.name === nominee.name);
    
    if (polymarketNominee) {
      updatedCount++;
      console.log(`  ${nominee.name}: ${polymarketNominee.odds} (${Math.round(polymarketNominee.probability * 100)}%)`);
      return {
        ...nominee,
        odds: {
          ...nominee.odds,
          polymarket: polymarketNominee.odds
        },
        lastUpdated: new Date().toISOString().split('T')[0]
      };
    } else {
      console.log(`  ${nominee.name}: Not found on Polymarket`);
      return nominee;
    }
  });
  
  // Save back to Firebase
  await ref.set(updatedNominees);
  console.log(`✓ Updated ${updatedCount}/${firebaseNominees.length} nominees`);
}

// Main execution
async function main() {
  console.log('=== Starting Polymarket Odds Update ===');
  console.log(`Time: ${new Date().toISOString()}`);
  
  for (const category of categories) {
    await updateCategory(category);
    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log('\n=== Update Complete ===');
  process.exit(0);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});