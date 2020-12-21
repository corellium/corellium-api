module.exports = {
    source: {include: ["src"]},
    opts: {
        recurse: true,
        template: "node_modules/docdash"
    },
    docdash: {
        static: true,
        sort: true,
        search: true,
        collapse: true,
        typedefs: true,
        removeQuotes: "none",
        scripts: []        
    },
    plugins: ['plugins/markdown'],
};
