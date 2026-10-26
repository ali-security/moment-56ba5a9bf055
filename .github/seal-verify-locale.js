// Loads every shipped bundle that lazy-requires locales and checks that a crafted
// non-string locale name (CVE-2026-17495) never reaches require(), while a plain
// string locale still does. Usage: node seal-verify-locale.js <unpacked package dir>
'use strict';

var fs = require('fs');
var path = require('path');
var Module = require('module');

var root = path.resolve(process.argv[2]);
var bundles = [
    'moment.js',
    'min/moment.min.js',
    'min/moment-with-locales.js',
    'min/moment-with-locales.min.js',
    'dist/moment.js',
];
var payload = '../min/locales';
var failures = 0;
var checked = 0;

function loadBundle(file) {
    var source = fs.readFileSync(file, 'utf8');
    var mod = new Module(file, module);
    mod.filename = file;
    mod.paths = Module._nodeModulePaths(path.dirname(file));
    if (/^export default hooks;$/m.test(source)) {
        // dist/moment.js is the ES module build: run the same code as CommonJS.
        source = source.replace(/^export default hooks;$/m, 'module.exports = hooks;');
    }
    mod._compile(source, file);
    return mod.exports;
}

function crafted() {
    var obj = {
        match: function () {
            return ['ok'];
        },
        toLowerCase: function () {
            return obj;
        },
        replace: function () {
            return obj;
        },
        split: function () {
            return [payload];
        },
        toString: function () {
            return payload;
        },
    };
    return obj;
}

function check(name, ok, detail) {
    console.log((ok ? 'ok     ' : 'FAILED ') + name + (detail ? ' ' + detail : ''));
    if (!ok) {
        failures++;
    }
}

bundles.forEach(function (rel) {
    var file = path.join(root, rel);
    var originalLoad = Module._load;
    var requested = [];
    var moment, before, hasFr;

    if (!fs.existsSync(file)) {
        console.log('skip   ' + rel + ' (not shipped)');
        return;
    }
    checked++;
    Module._load = function (request) {
        requested.push(String(request));
        return originalLoad.apply(this, arguments);
    };
    try {
        moment = loadBundle(file);
        moment.locale('en');
        before = moment.locales().length;
        hasFr = moment.locales().indexOf('fr') !== -1;

        moment.locale(crafted());
        moment.localeData(crafted());
        moment.defineLocale('seal-crafted-child', { parentLocale: crafted() });
        check(
            rel + ': crafted name never reaches require()',
            requested.filter(function (r) {
                return r.indexOf(payload) !== -1;
            }).length === 0,
            JSON.stringify(requested)
        );
        check(
            rel + ': global locale unchanged',
            moment.locale() === 'en',
            moment.locale()
        );
        check(
            rel + ': no locale registered by the payload',
            moment.locales().length === before,
            before + ' -> ' + moment.locales().length
        );

        requested = [];
        moment.defineLocale('seal-crafted-child', null);
        moment.locale('fr');
        if (hasFr) {
            check(rel + ': string locale fr still selectable', moment.locale() === 'fr');
        } else {
            check(
                rel + ": string locale fr still goes through require('./locale/fr')",
                requested.indexOf('./locale/fr') !== -1,
                JSON.stringify(requested)
            );
        }
    } catch (e) {
        check(rel + ': loads and runs', false, String(e && e.stack));
    } finally {
        Module._load = originalLoad;
    }
});

check('at least one bundle checked', checked > 0);
if (failures) {
    console.error(failures + ' check(s) failed');
    process.exit(1);
}
console.log('all ' + checked + ' bundles verified');
