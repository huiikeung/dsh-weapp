module.exports = app => app.pages.concat((app.subPackages || []).flatMap(pkg => pkg.pages.map(page => pkg.root + '/' + page)));
