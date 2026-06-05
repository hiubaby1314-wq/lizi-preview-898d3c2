const BetterSqliteDB = require('better-sqlite3');
const path = require('path');

// Thin wrapper to maintain backward compatibility with the existing API.
// better-sqlite3 natively provides .prepare().get/.all/.run, .exec, .pragma, .close
// with the same signatures as the old sql.js compat layer.
module.exports = class CompatDB {
  constructor(_unused, filePath) {
    // _unused is kept for API compatibility (old code passes SQL as first arg)
    this._db = new BetterSqliteDB(filePath);
  }

  pragma(str) {
    try { this._db.pragma(str); } catch (e) {}
  }

  exec(sql) {
    this._db.exec(sql);
  }

  prepare(sql) {
    return this._db.prepare(sql);
  }

  close() {
    this._db.close();
  }
};
