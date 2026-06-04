function ensureLoggedIn(req, res, next) {
  if (!req.session.user) {
    req.flash('error', 'Please log in to continue.');
    return res.redirect('/login');
  }
  next();
}

function ensureRole(role) {
  return (req, res, next) => {
    if (!req.session.user || req.session.user.role !== role) {
      req.flash('error', 'You do not have permission to access that page.');
      return res.redirect('/');
    }
    next();
  };
}

module.exports = { ensureLoggedIn, ensureRole };
