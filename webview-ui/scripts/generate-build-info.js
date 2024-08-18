const fs = require('fs');
const path = require('path');

const buildInfo = {
  buildNumber: Date.now(),
  buildTimestamp: new Date().toISOString()
};

const buildInfoPath = path.join(__dirname, '..', 'src', 'buildInfo.json');

fs.writeFileSync(buildInfoPath, JSON.stringify(buildInfo, null, 2));

console.log('Build info generated successfully:', buildInfo);
