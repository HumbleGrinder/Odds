const fetch = require('node-fetch');
const admin = require('firebase-admin');

// Initialize Firebase
const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://odds-32154-default-rtdb.firebaseio.com"
});

const db = admin.database();

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

// Fetch a single Oscars category
async function fetchCategory(slug, firebasePath) {
  console.log(`\nFetching ${slug}...`);
  
  try {
    const url = `https://gamma-api.polymarket.com/events?slug=${slug}`;
    const response = await fetch(url);
    
    if (!response.ok) {
      console.log(`  ✗ HTTP ${response.status}: ${response.statusText}`);
      return null;
    }
    
    const text = await response.text();
    if (!text || text.trim() === '') {
      console.log(`  ✗ Empty response`);
      return null;
    }
    
    const data = JSON.parse(text);
    
    if (!Array.isArray(data) || data.length === 0) {
      console.log(`  ✗ No events found`);
      return null;
    }
    
    const event = data[0];
    console.log(`  ✓ Found event: ${event.title}`);
    console.log(`  ✓ ${event.markets?.length || 0} markets`);
    
    if (!event.markets || event.markets.length === 0) {
      console.log(`  ✗ No markets in event`);
      return null;
    }
    
    // Extract nominees
    const nominees = event.markets.map(market => {
      const prices = JSON.parse(market.outcomePrices);
      const probability = parseFloat(prices[0]);
      
      return {
        name: market.groupItemTitle,
        probability: probability,
        odds: probToAmericanOdds(probability)
      };
    }).filter(n => n.name && !n.name.match(/^(Other|Film [A-Z])$/i));
    
    console.log(`  ✓ Found ${nominees.length} nominees:`);
    nominees.forEach(n => {
      console.log(`    - ${n.name}: ${n.odds} (${Math.round(n.probability * 100)}%)`);
    });
    
    return nominees;
    
  } catch (error) {
    console.log(`  ✗ Error: ${error.message}`);
    return null;
  }
}

// Update Firebase
async function updateFirebase(nominees, firebasePath) {
  if (!nominees || nominees.length === 0) {
    console.log(`  Skipping Firebase update - no data`);
    return;
  }
  
  const ref = db.ref(`${firebasePath}/nominees`);
  const snapshot = await ref.once('value');
  const firebaseNominees = snapshot.val() || [];
  
  if (firebaseNominees.length === 0) {
    console.log(`  No nominees in Firebase at ${firebasePath}`);
    return;
  }
  
  let updatedCount = 0;
  const updatedNominees = firebaseNominees.map(nominee => {
    const polymarketNominee = nominees.find(p => 
      p.name.toLowerCase() === nominee.name.toLowerCase()
    );
    
    if (polymarketNominee) {
      updatedCount++;
      return {
        ...nominee,
        odds: {
          ...nominee.odds,
          polymarket: polymarketNominee.odds
        },
        lastUpdated: new Date().toISOString().split('T')[0]
      };
    }
    return nominee;
  });
  
  await ref.set(updatedNominees);
  console.log(`  ✓ Updated ${updatedCount}/${firebaseNominees.length} nominees in Firebase`);
}

// Main
async function main() {
  console.log('=== Polymarket Odds Update ===');
  console.log(`Time: ${new Date().toISOString()}\n`);
  
  const categories = [
    { slug: 'oscars-2026-best-picture-winner', path: 'oscars/best-picture' },
    { slug: 'oscars-2026-best-director-winner', path: 'oscars/best-director' },
    { slug: 'oscars-2026-best-actor-winner', path: 'oscars/best-actor' },
    { slug: 'oscars-2026-best-actress-winner', path: 'oscars/best-actress' },
    { slug: 'oscars-2026-best-supporting-actor-winner', path: 'oscars/best-supporting-actor' },
    { slug: 'oscars-2026-best-supporting-actress-winner', path: 'oscars/best-supporting-actress' }
  ];
  
  for (const category of categories) {
    const nominees = await fetchCategory(category.slug, category.path);
    if (nominees) {
      await updateFirebase(nominees, category.path);
    }
    await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
  }
  
  console.log('\n=== Complete ===');
  process.exit(0);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});