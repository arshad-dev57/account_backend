function isPlatformOwner(email) {
  const emails = (process.env.PLATFORM_OWNER_EMAILS || 'mfaisalakhan@gmail.com,kashif@gmail.com,admin@bisonstechs.dev')
    .split(',').map((e) => e.trim().toLowerCase());
  return emails.includes((email || '').toLowerCase());
}

module.exports = function platformOwner(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Not authenticated' });
  }
  if (!isPlatformOwner(req.user.email)) {
    return res.status(403).json({ success: false, message: 'Platform owner access required' });
  }
  next();
};
