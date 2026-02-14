const fetch = require('node-fetch');
const admin = require('firebase-admin');

// Initialize Firebase
const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://odds-32154-default-rtdb.firebaseio.com"
});

const db = admin.database();

// Category mapping: search keywords → Firebase path
const categories = [
  { search: 'Oscars 2026: Best Picture Winner', path: 'oscars/best-picture', category: 'Best Picture' },
  { search: 'Oscars 2026: Best Director Winner', path: 'oscars/best-director', category: 'Best Director' },
  { search: 'Oscars 2026: Best Actor Winner', path: 'oscars/best-actor', category: 'Best Actor' },
  { search: 'Oscars 2026: Best Actress Winner', path: 'oscars/best-actress', category: 'Best Actress' },
  { search: 'Oscars 2026: Best Supporting Actor Winner', path: 'oscars/best-supporting-actor', category: 'Best Supporting Actor' },
  { search: 'Oscars 2026: Best Supporting Actress Winner', path: 'oscars/best-supporting-actress', category: 'Best Supporting Actress' }
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

// Fetch all active Oscars markets
async function fetchAllOscarsMarkets() {
  try {
    // Fetch active markets with pagination
    const allMarkets = [];
    let offset = 0;
    const limit = 100;
    
    while (true) {
      const url = `https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=${limit}&offset=${offset}`;
      console.log(`Fetching markets: offset ${offset}, limit ${limit}`);
      
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const markets = await response.json();
      
      if (!Array.isArray(markets) || markets.length === 0) {
        console.log('No more markets found');
        break;
      }
      
      console.log(`Received ${markets.length} markets`);
      
      // Filter for Oscars 2026 markets
      const oscarsMarkets = markets.filter(m => 
        m.question && (
          m.question.includes('Oscars 2026') || 
          m.question.includes('Academy Awards 2026')
        )
      );
      
      console.log(`Found ${oscarsMarkets.length} Oscars markets in this batch`);
      allMarkets.push(...oscarsMarkets);
      
      if (markets.length < limit) {
        break; // No more pages
      }
      
      offset += limit;
      
      // Stop after reasonable number of pages to avoid rate limiting
      if (offset >= 500) {
        console.log('Reached max offset, stopping pagination');
        break;
      }
    }
    
    console.log(`Found ${allMarkets.length} total Oscars 2026 markets`);
    return allMarkets;
  } catch (error) {
    console.error(`Error fetching Oscars markets:`, error.message);
    return [];
  }
}

// Extract nominees from markets for a specific category
function extractNominees(markets, categorySearch) {
  const categoryMarkets = markets.filter(m => 
    m.question && m.question.includes(categorySearch)
  );
  
  console.log(`  Found ${categoryMarkets.length} markets for "${categorySearch}"`);
  
  if (categoryMarkets.length === 0) {
    return [];
  }
  
  const nominees = [];
  
  for (const market of categoryMarkets) {
    try {
      // Parse outcomes and prices
      const outcomes = market.outcomes ? JSON.parse(market.outcomes) : [];
      const outcomePrices = market.outcomePrices ? JSON.parse(market.outcomePrices) : [];
      
      // Use groupItemTitle if available, otherwise use outcomes
      const name = market.groupItemTitle || (outcomes.length > 0 ? outcomes[0] : null);
      
      if (name && outcomePrices.length > 0) {
        const probability = parseFloat(outcomePrices[0]);
        
        // Skip "Other" or generic placeholder entries
        if (!name.match(/^(Other|Movie [A-Z]|Actor [A-Z]|Actress [A-Z]|Director [A-Z]|Film [A-Z])$/i)) {
          nominees.push({
            name: name,
            probability: probability,
            odds: probToAmericanOdds(probability)
          });
        }
      }
    } catch (error) {
      console.error(`  Error parsing market "${market.question}":`, error.message);
    }
  }
  
  // Sort by probability (highest first)
  nominees.sort((a, b) => b.probability - a.probability);
  
  return nominees;
}

// Update Firebase with Polymarket odds
async function updateCategory(category, allMarkets) {
  console.log(`\nUpdating ${category.path}...`);
  
  // Extract nominees for this category
  const polymarketData = extractNominees(allMarkets, category.search);
  
  if (polymarketData.length === 0) {
    console.log(`Skipping ${category.path} - no Polymarket data found`);
    return;
  }
  
  console.log(`Found ${polymarketData.length} nominees on Polymarket:`);
  polymarketData.forEach(n => {
    console.log(`  ${n.name}: ${n.odds} (${Math.round(n.probability * 100)}%)`);
  });
  
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
    const polymarketNominee = polymarketData.find(p => 
      p.name.toLowerCase() === nominee.name.toLowerCase() ||
      p.name.includes(nominee.name) ||
      nominee.name.includes(p.name)
    );
    
    if (polymarketNominee) {
      updatedCount++;
      console.log(`  ✓ Matched: ${nominee.name} → ${polymarketNominee.odds}`);
      return {
        ...nominee,
        odds: {
          ...nominee.odds,
          polymarket: polymarketNominee.odds
        },
        lastUpdated: new Date().toISOString().split('T')[0]
      };
    } else {
      console.log(`  ✗ Not matched: ${nominee.name}`);
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
  console.log();
  
  // Fetch all Oscars markets once
  const allMarkets = await fetchAllOscarsMarkets();
  
  if (allMarkets.length === 0) {
    console.log('\n⚠️  No Oscars markets found. Exiting.');
    process.exit(0);
  }
  
  // Update each category
  for (const category of categories) {
    await updateCategory(category, allMarkets);
    // Small delay to avoid overwhelming Firebase
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  console.log('\n=== Update Complete ===');
  process.exit(0);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
