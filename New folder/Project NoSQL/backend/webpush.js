const webPush = require('web-push');
require('dotenv').config();

webPush.setVapidDetails(
  'mailto:admin@classalert.com',
  process.env.PUBLIC_VAPID_KEY,
  process.env.PRIVATE_VAPID_KEY
);

module.exports = webPush;