const fetch = require('node-fetch');
const admin = require('firebase-admin');

// Initialize Firebase (reuse existing config if already initialized)
if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://odds-32154-default-rtdb.firebaseio.com"
  });
}

const db = admin.database();

// Convert Kalshi price (cents) to American odds
function kalshiPriceToAmericanOdds(priceInCents) {
  const prob = priceInCents / 100; // Convert cents to probability (0-1)
  
  if (prob >= 0.5) {
    const odds = Math.round(-(prob * 100) / (1 - prob));
    return `${odds}`;
  } else {
    const odds = Math.round(((1 - prob) * 100) / prob);
    return `+${odds}`;
  }
}

// Fetch Kalshi market data
async function fetchKalshiData(seriesTicker) {
  try {
    const url = `https://api.elections.kalshi.com/trade-api/v2/markets?series_ticker=${seriesTicker}&status=open&limit=100`;
    const response = await fetch(url);
    
    if (!response.ok) {
      console.log(`  ✗ HTTP ${response.status}: ${response.statusText}`);
      return [];
    }
    
    const data = await response.json();
    
    if (!data.markets || data.markets.length === 0) {
      return [];
    }
    
    const nominees = [];
    
    for (const market of data.markets) {
      try {
        // Extract nominee name from market title or ticker
        // Kalshi market titles typically include the nominee name
        const name = market.title || market.subtitle || '';
        const yesPrice = market.yes_price; // Price in cents (0-100)
        
        if (name && yesPrice !== undefined && yesPrice !== null) {
          nominees.push({
            name: name.trim(),
            odds: kalshiPriceToAmericanOdds(yesPrice)
          });
        }
      } catch (error) {
        // Skip invalid markets
        console.log(`  - Skipping market: ${error.message}`);
      }
    }
    
    return nominees;
  } catch (error) {
    console.log(`  ✗ Error fetching: ${error.message}`);
    return [];
  }
}

// Update a single category
async function updateCategory(seriesTicker, firebasePath, categoryName) {
  console.log(`\n${categoryName}:`);
  
  // Fetch Kalshi data
  const kalshiNominees = await fetchKalshiData(seriesTicker);
  
  if (kalshiNominees.length === 0) {
    console.log(`  - No Kalshi data (market may not exist or be closed)`);
    return;
  }
  
  console.log(`  ✓ Found ${kalshiNominees.length} nominees on Kalshi`);
  
  // Get existing Firebase data
  const ref = db.ref(`${firebasePath}/nominees`);
  const snapshot = await ref.once('value');
  const firebaseNominees = snapshot.val();
  
  if (!firebaseNominees) {
    console.log(`  ✗ No nominees in Firebase at ${firebasePath}`);
    return;
  }
  
  // Update each nominee's Kalshi odds
  let updatedCount = 0;
  const updates = {};
  
  firebaseNominees.forEach((nominee, index) => {
    // Find matching Kalshi nominee
    const kalshiMatch = kalshiNominees.find(k => 
      k.name.toLowerCase().includes(nominee.name.toLowerCase()) ||
      nominee.name.toLowerCase().includes(k.name.toLowerCase()) ||
      k.name.toLowerCase() === nominee.name.toLowerCase()
    );
    
    if (kalshiMatch) {
      // Update the kalshi field inside odds
      updates[`${index}/odds/kalshi`] = kalshiMatch.odds;
      updates[`${index}/lastUpdated`] = new Date().toISOString().split('T')[0];
      updatedCount++;
      console.log(`  ✓ ${nominee.name}: ${kalshiMatch.odds}`);
    } else {
      console.log(`  - ${nominee.name}: Not found on Kalshi`);
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
  console.log('=== Updating Kalshi BAFTA Odds ===');
  console.log(`Time: ${new Date().toISOString()}\n`);
  
  const categories = [
    // Main categories
    { ticker: 'KXBAFTAFILM', path: 'baftas/picture', name: 'Best Picture' },
    { ticker: 'KXBAFTADIRE', path: 'baftas/director', name: 'Best Director' },
    
    // Acting categories
    { ticker: 'KXBAFTAACTO', path: 'baftas/actor', name: 'Best Actor' },
    { ticker: 'KXBAFTAACTR', path: 'baftas/actress', name: 'Best Actress' },
    { ticker: 'KXBAFTASUPACTO', path: 'baftas/supporting-actor', name: 'Best Supporting Actor' },
    { ticker: 'KXBAFTASUPACTR', path: 'baftas/supporting-actress', name: 'Best Supporting Actress' },
    
    // Writing categories
    { ticker: 'KXBAFTAORIG', path: 'baftas/original', name: 'Best Original Screenplay' },
    { ticker: 'KXBAFTAADAP', path: 'baftas/adapted', name: 'Best Adapted Screenplay' },
    
    // Other categories
    { ticker: 'KXBAFTACAST', path: 'baftas/casting', name: 'Best Casting' },
    { ticker: 'KXBAFTABRIT', path: 'baftas/british-film', name: 'Best British Film' },
    { ticker: 'KXBAFTAINTE', path: 'baftas/international', name: 'Best International Feature Film' },
    { ticker: 'KXBAFTADOCU', path: 'baftas/documentary', name: 'Best Documentary Feature' },
    { ticker: 'KXBAFTAANIM', path: 'baftas/animated', name: 'Best Animated Feature Film' },
    
    // Technical categories
    { ticker: 'KXBAFTACINE', path: 'baftas/cinemato', name: 'Best Cinematography' },
    { ticker: 'KXBAFTAEDIT', path: 'baftas/editing', name: 'Best Editing' }
  ];
  
  for (const category of categories) {
    await updateCategory(category.ticker, category.path, category.name);
    await new Promise(resolve => setTimeout(resolve, 1500)); // 1.5 second delay between requests
  }
  
  console.log('\n=== Update Complete ===');
  process.exit(0);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
