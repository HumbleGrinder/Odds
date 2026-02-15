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

// Fetch Polymarket data
async function fetchPolymarketData(slug) {
  try {
    const url = `https://gamma-api.polymarket.com/events?slug=${slug}`;
    const response = await fetch(url);
    const text = await response.text();
    const data = JSON.parse(text);
    
    if (!Array.isArray(data) || data.length === 0) {
      return [];
    }
    
    const event = data[0];
    const nominees = [];
    
    for (const market of event.markets) {
      try {
        if (typeof market.outcomePrices === 'string') {
          const prices = JSON.parse(market.outcomePrices);
          const probability = parseFloat(prices[0]);
          const name = market.groupItemTitle;
          
          if (name && !name.match(/^(Other|Movie [A-Z]|Actor [A-Z]|Actress [A-Z]|Director [A-Z]|Film [A-Z])$/i)) {
            nominees.push({
              name: name,
              odds: probToAmericanOdds(probability)
            });
          }
        }
      } catch (error) {
        // Skip invalid markets
      }
    }
    
    return nominees;
  } catch (error) {
    console.log(`  ✗ Error fetching: ${error.message}`);
    return [];
  }
}

// Update a single category
async function updateCategory(slug, firebasePath, categoryName) {
  console.log(`\n${categoryName}:`);
  
  // Fetch Polymarket data
  const polymarketNominees = await fetchPolymarketData(slug);
  
  if (polymarketNominees.length === 0) {
    console.log(`  - No Polymarket data (market may not exist)`);
    return;
  }
  
  console.log(`  ✓ Found ${polymarketNominees.length} nominees on Polymarket`);
  
  // Get existing Firebase data
  const ref = db.ref(`${firebasePath}/nominees`);
  const snapshot = await ref.once('value');
  const firebaseNominees = snapshot.val();
  
  if (!firebaseNominees) {
    console.log(`  ✗ No nominees in Firebase at ${firebasePath}`);
    return;
  }
  
  // Update each nominee's Polymarket odds
  let updatedCount = 0;
  const updates = {};
  
  firebaseNominees.forEach((nominee, index) => {
    // Find matching Polymarket nominee
    const polymarketMatch = polymarketNominees.find(p => 
      p.name.toLowerCase() === nominee.name.toLowerCase() ||
      p.name.toLowerCase().includes(nominee.name.toLowerCase()) ||
      nominee.name.toLowerCase().includes(p.name.toLowerCase())
    );
    
    if (polymarketMatch) {
      // Only update the polymarket field inside odds
      updates[`${index}/odds/polymarket`] = polymarketMatch.odds;
      updates[`${index}/lastUpdated`] = new Date().toISOString().split('T')[0];
      updatedCount++;
      console.log(`  ✓ ${nominee.name}: ${polymarketMatch.odds}`);
    } else {
      console.log(`  - ${nominee.name}: Not found on Polymarket`);
    }
  });
  
  // Apply updates to Firebase
  if (Object.keys(updates).length > 0) {
    await ref.update(updates);
    console.log(`  ✓ Updated ${updatedCount} nominees in Firebase`);
  }
}

// Main
async function main() {
  console.log('=== Updating Polymarket Odds ===');
  console.log(`Time: ${new Date().toISOString()}\n`);
  
  const categories = [
    // Acting categories
    { slug: 'oscars-2026-best-actor-winner', path: 'oscars/actor', name: 'Best Actor' },
    { slug: 'oscars-2026-best-actress-winner', path: 'oscars/actress', name: 'Best Actress' },
    { slug: 'oscars-2026-best-supporting-actor-winner', path: 'oscars/supporting-actor', name: 'Best Supporting Actor' },
    { slug: 'oscars-2026-best-supporting-actress-winner', path: 'oscars/supporting-actress', name: 'Best Supporting Actress' },
    
    // Main categories
    { slug: 'oscars-2026-best-picture-winner', path: 'oscars/picture', name: 'Best Picture' },
    { slug: 'oscars-2026-best-director-winner', path: 'oscars/director', name: 'Best Director' },
    
    // Writing categories
    { slug: 'oscars-2026-best-adapted-screenplay-winner', path: 'oscars/adapted', name: 'Best Adapted Screenplay' },
    { slug: 'oscars-2026-best-original-screenplay-winner', path: 'oscars/original', name: 'Best Original Screenplay' },
    
    // Technical categories
    { slug: 'oscars-2026-best-cinematography-winner', path: 'oscars/cinemato', name: 'Best Cinematography' },
    { slug: 'oscars-2026-best-film-editing-winner', path: 'oscars/editing', name: 'Best Film Editing' },
    { slug: 'oscars-2026-best-production-design-winner', path: 'oscars/production', name: 'Best Production Design' },
    { slug: 'oscars-2026-best-costume-design-winner', path: 'oscars/costumes', name: 'Best Costume Design' },
    { slug: 'oscars-2026-best-sound-winner', path: 'oscars/sound', name: 'Best Sound' },
    
    // Music categories
    { slug: 'oscars-2026-best-original-score-winner', path: 'oscars/score', name: 'Best Original Score' },
    { slug: 'oscars-2026-best-original-song-winner', path: 'oscars/song', name: 'Best Original Song' },
    
    // Other film categories
    { slug: 'oscars-2026-best-animated-feature-winner', path: 'oscars/animated', name: 'Best Animated Feature' },
    { slug: 'oscars-2026-best-documentary-feature-winner', path: 'oscars/documentary', name: 'Best Documentary Feature' },
    { slug: 'oscars-2026-best-international-feature-film-winner', path: 'oscars/international', name: 'Best International Feature Film' },
    
    // Casting (may not exist on Polymarket)
    { slug: 'oscars-2026-best-casting-winner', path: 'oscars/casting', name: 'Best Casting' }
  ];
  
  for (const category of categories) {
    await updateCategory(category.slug, category.path, category.name);
    await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay between requests
  }
  
  console.log('\n=== Update Complete ===');
  process.exit(0);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});