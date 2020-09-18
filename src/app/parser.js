const RdfXmlParser = require("rdfxml-streaming-parser").RdfXmlParser;
const JsonLdParser = require("jsonld-streaming-parser").JsonLdParser;
const N3Parser = require("@rdfjs/parser-n3");
const Transform = require("stream").Transform;
const ts = require("./triplestore");
const sortThreshold = 5000;
let blankNodeOffset;

function obtainTriplestore(inputStream, decoder, format, contentScript, baseIRI) {
    return new Promise((resolve, reject) => {
        const parser = getParser(format, baseIRI);
        if (!parser)
            reject("Unsupported format");
        ts.getTriplestore(contentScript).then(store => {
            const transformStream = new Transform({
                transform(chunk, encoding, callback) {
                    this.push(chunk);
                    callback();
                }
            });
            if (contentScript) {
                document.getElementById("status").innerText = "Status: fetching file...";
                inputStream.read().then(function processText({done, value}) {
                    if (done)
                        transformStream.push(null);
                    else {
                        handleInput(value, transformStream);
                        inputStream.read().then(processText);
                    }
                });
            } else {
                inputStream.onstop = () => {
                    transformStream.push(null);
                };
                inputStream.ondata = event => {
                    handleInput(event.data, transformStream);
                };
            }
            const outputStream = parser.import(transformStream);
            let counter = 1;
            blankNodeOffset = -1;
            outputStream
                .on("context", context => {
                    for (const prefix in context) {
                        if (typeof context[prefix] === "string")
                            store.addPrefix(prefix, context[prefix]);
                    }
                })
                .on("data", triple => {
                    const subject = processResource(store, triple.subject);
                    const predicate = processResource(store, triple.predicate);
                    const object = processResource(store, triple.object);
                    store.addTriple(subject, predicate, object);
                    if (contentScript)
                        document.getElementById("status").innerText =
                            "Status: processing " + counter + " triples...";
                    counter++;
                })
                .on("prefix", (prefix, ns) => {
                    if (typeof ns.value === "string" && /^http/.test(ns.value))
                        store.addPrefix(prefix, ns.value);
                })
                .on("error", error => {
                    if (contentScript)
                        document.getElementById("status").innerText =
                            "Status: parsing error: " + error + " (see console for more details)";
                    reject(error);
                })
                .on("end", () => {
                    store.finalize(counter <= sortThreshold);
                    resolve(store);
                });
        });
    });

    function handleInput(value, transformStream) {
        let data = decoder.decode(value, {stream: true});
        if (typeof data === "string")
            //data = data.replace(new RegExp("<>", 'g'), "<#>"); //workaround for empty URIs - no longer needed?
            transformStream.push(data);
    }
}

function getParser(format, baseIRI) {
    let parser = null;
    switch (format) {
        case "application/rdf+xml":
            parser = new RdfXmlParser();
            break;
        case "application/ld+json":
            parser = new JsonLdParser({
                baseIRI: baseIRI
            });
            break;
        case "application/trig":
        case "application/n-quads":
        case "application/n-triples":
        case "text/n3":
        case "text/turtle":
            parser = new N3Parser();
            break;
    }
    return parser;
}

function processResource(store, resource) {
    const value = resource.value;
    const resourceType = Object.getPrototypeOf(resource).termType || resource.termType;
    if (!resourceType)
        return null;
    switch (resourceType) {
        case "BlankNode":
            if (/^b[0-9]+$/.test(value)) {
                const blankNodeNumber = value.substring(1, value.length);
                if (blankNodeOffset === -1)
                    blankNodeOffset = blankNodeNumber;
                return store.getBlankNode("b" + (blankNodeNumber - blankNodeOffset));
            }
            return store.getBlankNode(value);
        case "NamedNode":
            return store.getURI(value);
        case "Literal":
            return store.getLiteral(value, resource.datatype.value, resource.language);
    }
    return null;
}

module.exports = {obtainTriplestore};