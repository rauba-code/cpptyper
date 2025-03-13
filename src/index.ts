// const repl = require('node:repl');
//const process = require('node:process');
// const { Buffer } = require('node:buffer');

const message: string = "Hello, world!";
console.log(message);

process.on('SIGINT', () => {
    console.log('Received SIGINT. Press Control-D to exit.');
});

class TypeParseError extends Error {
    constructor(...params: any[]) {
        super(...params);
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, TypeParseError);
        }
        this.name = "TypeParseError";
        Object.setPrototypeOf(this, TypeParseError.prototype)
    }
}

const term = {
    "FUNCTION": null,
    "VOID": null,
    "NULLPTR": null,
    "LREF": null,
    "ARRAY": null,
    "CLASS": null,
    "MEMBER": null,
    "PTR": null,
    "I8": null,
    "U8": null,
    "I16": null,
    "U16": null,
    "I32": null,
    "U32": null,
    "I64": null,
    "U64": null,
    "F32": null,
    "F64": null,
    "BOOL": null,
    "STRINGLITERAL": null, // unused
    "CHARLITERAL": null, // unused
    "INTLITERAL": null, // unused
    "FLOATLITERAL": null, // unused
    "<": null,
    ">": null,
    "(": null,
    ")": null
} as const;
type Term = keyof (typeof term);

const nonTerm = {
    "TemplateParamPlus": null,
    "TemplateParamOrEnd": null,
    "FunctionParamPlus": null,
    "FunctionParamOrEnd": null,
    "Member": null,
    "Function": null,
    "Type": null,
    "Object": null,
    "ParamObject": null,
    "Parametric": null,
    "LRef": null,
    "LValue": null,
    "Pointer": null,
    "Pointee": null,
    "Array": null,
    "ArraySize": null,
    "Class": null,
    "Arithmetic": null,
    "Literal": null, // unused
    "ObjectOrFunction": null,
    "Return": null
} as const;
type NonTerm = keyof (typeof nonTerm);

const specTerm = {
    "identifier": null,
    "positiveint": null,
}
type SpecTerm = keyof (typeof specTerm);

type LexSym = Term | NonTerm | SpecTerm;

const typeBNF: { [symbol: string]: LexSym[][] } = {
    "Type": [["Object", "VOID", "Function", "LRef"]],
    "Object": [["ParamObject", "Array"]],
    "ParamObject": [["Class", "Arithmetic", "NULLPTR", "Pointer", "Member"]],
    "Parametric": [["ParamObject", "LRef"]],
    "Member": [["MEMBER"], ["Class"], ["Class"]],
    "LRef": [["LREF"], ["LValue"]],
    "LValue": [["Object", "Function"]],
    "Pointee": [["LValue", "VOID"]],
    "Pointer": [["PTR"], ["Pointee"]],
    "Array": [["ARRAY"], ["Object"], ["ArraySize"]],
    "ArraySize": [["positiveint"]],
    "Class": [["CLASS"], ["identifier"], ["<"], ["TemplateParamOrEnd"]],
    "Arithmetic": [["I8", "U8", "I16", "U16", "I32", "U32", "I64", "U64", "F32", "F64", "BOOL"]],
    "Function": [["FUNCTION"], ["Return"], ["("], ["FunctionParamOrEnd"]],
    "FunctionParamOrEnd": [["FunctionParamPlus", ")"]],
    "FunctionParamPlus": [["Parametric"], ["FunctionParamOrEnd"]],
    "TemplateParamOrEnd": [["TemplateParamPlus", ">"]],
    "TemplateParamPlus": [["Parametric"], ["TemplateParamOrEnd"]],
    "Return": [["Parametric", "VOID"]]
};

type Parser = { [symbol: string]: { [startsWith: string]: NonTerm | SpecTerm | null }[] }

console.time("create_parser")
function constructTypeParser(): Parser {
    let result: Parser = {};
    Object.keys(typeBNF).forEach((key: string) => {
        result[key] = new Array();
        typeBNF[key].forEach((union: LexSym[], fieldIdx: number) => {
            result[key].push({});
            union.forEach((element: LexSym) => {
                if (element in term || element in specTerm) {
                    result[key][fieldIdx][element] = null;
                }
            })
        })
        result[key][0][key as NonTerm] = null;
    })
    let i = 0;
    while (true) {
        let dirty: boolean = false;
        Object.keys(typeBNF).forEach((key: string) => {
            typeBNF[key].forEach((union: LexSym[], fieldIdx: number) => {
                union.forEach((nterm: LexSym) => {
                    if (nterm in nonTerm) {
                        if (!(nterm in result)) {
                            throw new TypeParseError(`NonTerm ${nterm} is outside the grammar tree`);
                        }
                        Object.keys(result[nterm][0]).forEach((startsWith) => {
                            if (!(startsWith in result[key][fieldIdx])) {
                                result[key][fieldIdx][startsWith] = nterm as NonTerm;
                                dirty = true;
                            }
                        })
                    }
                })
            })
        })
        if (!dirty) {
            break;
        }
        i++;
        if (i > 1000) {
            throw new TypeParseError("Perpetual loop detected")
        }
    }

    return result;
}
const typeParser = constructTypeParser();
console.timeEnd("create_parser");
//console.log(typeParser);

interface ParsedLemma {
    ok: boolean,
    result: string[],
    sentence: string[]
}

const wildcardDeclarator: string = '!';
const wildcardSpecifier: string = '?';

function preparse(sentence: string[], strict_order: boolean = true): { sentence: string[], wildcardMap: number[] } {
    let targets: string[] = new Array();
    while (sentence.length > 0 && sentence[0].startsWith(wildcardDeclarator)) {
        targets.push(sentence[0].slice(1));
        sentence = sentence.slice(1);
    }
    let wildcardMap: number[] = [];
    if (targets.length === 0) {
        return { sentence, wildcardMap };
    }
    let expectedMaxId: number = 0;
    let anonWildcardId: number = targets.length;
    return {
        sentence: sentence.map((x: string) => {
            if (x.startsWith(wildcardSpecifier)) {
                const wildcardId: number = parseInt(x.slice(1));
                if (!(wildcardId >= 0 && wildcardId < targets.length)) {
                    throw new TypeParseError(`Wildcard ${x} is out of bounds`);
                }
                if (strict_order && expectedMaxId < wildcardId) {
                    throw new TypeParseError(`Wildcard ${x} precedes ?${expectedMaxId}`);
                }
                if (wildcardId === expectedMaxId) {
                    expectedMaxId++;
                }
                wildcardMap.push(wildcardId);
                return targets[wildcardId];
            } else if (x.startsWith(wildcardDeclarator)) {
                throw new TypeParseError('Wildcard declarator detected after the start of the sentence')
            } else {
                if (x in nonTerm) {
                    wildcardMap.push(anonWildcardId++);
                }
                return x;
            }
        }),
        wildcardMap
    };
}

function parse(parser: Parser, scope: NonTerm, sentence: string[]): string[] | null {
    let endLoop: boolean = false;
    let result: string[] | null = sentence;
    parser[scope].forEach((argument) => {
        if (result === null || endLoop) {
            return;
        }
        if (result.length > 0 && result[0] in argument) {
            const innerScope: NonTerm | null = argument[result[0]] as NonTerm | null;
            if (innerScope === null) {
                if (result[0] === scope) {
                    endLoop = true;
                }
                result = result.slice(1);
            } else {
                result = parse(parser, innerScope as NonTerm, result);
            }
        } else if (result.length > 0 && "identifier" in argument) {
            result = result.slice(1);
        } else if (result.length > 0 && "positiveint" in argument) {
            if (!(parseInt(result[0]) > 0)) {
                result = null;
            } else {
                result = result.slice(1);
            }
        } else {
            result = null;
        }
    });
    return result;
}

function parsePretty(parser: Parser, scope: NonTerm, sentence: string[]): ParsedLemma {
    let result: string[] = ["(", scope];
    let ok: boolean = true;
    let endLoop: boolean = false;
    parser[scope].forEach((argument) => {
        if (!ok || endLoop) {
            return;
        }
        if (sentence.length > 0 && sentence[0] in argument) {
            const innerScope: NonTerm | null = argument[sentence[0]] as NonTerm | null;
            if (innerScope === null) {
                if (sentence[0] === scope) {
                    endLoop = true;
                } else {
                    result.push(sentence[0]);
                }
                sentence = sentence.slice(1);
            } else {
                const parseResult = parsePretty(parser, innerScope as NonTerm, sentence);
                result = result.concat(parseResult.result);
                sentence = parseResult.sentence;
                ok = parseResult.ok;
            }
        } else if (sentence.length > 0 && "identifier" in argument) {
            result.push(sentence[0]);
            sentence = sentence.slice(1);
        } else if (sentence.length > 0 && "positiveint" in argument) {
            if (!(parseInt(sentence[0]) > 0)) {
                result.push("{Expected positive integer}");
                ok = false;
                sentence = [];
            } else {
                result.push(sentence[0]);
                sentence = sentence.slice(1);
            }
        } else {
            result.push("{Expected one of: " + Object.keys(argument).join(", ") + "}");
            ok = false;
            sentence = [];
        }
    });
    result.push(")");
    return { ok, result, sentence };
}

interface SigPair {
    subtype: string[],
    subwc: number[],
    supertype: string[]
    superwc: number[],
    wildcards: (number | string[])[],
}

function arrayValuesEqual(a: string[], b: string[]): boolean {
    if (a.length !== b.length) {
        return false;
    }
    for (let i: number = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
            return false;
        }
    }
    return true;
}

function parseSubset(parser: Parser, scope: NonTerm, pair: SigPair): boolean {
    let retv: boolean | null = null;
    parser[scope].forEach((argument) => {
        if (retv !== null) {
            return;
        }
        if (pair.supertype.length > 0 && pair.supertype[0] in argument) {
            const innerScope: NonTerm | null = argument[pair.supertype[0]] as NonTerm | null;
            if (innerScope === null) {
                if (pair.supertype[0] === scope) {
                    // wildcard management
                    pair.supertype = pair.supertype.slice(1);
                    const subtype0 = pair.subtype;
                    let r = parse(parser, scope, pair.subtype);
                    if (r !== null) {
                        const wcInstance = subtype0.slice(0, subtype0.length - r.length);
                        let subresult: number | string[];
                        if (wcInstance.length === 1 && wcInstance[0] in nonTerm) {
                            // subset is also a wildcard
                            subresult = pair.subwc[0];
                            pair.subwc = pair.subwc.slice(1);
                        } else {
                            subresult = wcInstance;
                        }
                        const superwc: number | string[] = pair.wildcards[pair.superwc[0]];
                        if (superwc === undefined) {
                            pair.wildcards[pair.superwc[0]] = subresult;
                        } else if (typeof superwc === "number") {
                            if (superwc !== subresult) {
                                retv = false;
                            }
                        } else {
                            // superwc is an array
                            if (typeof subresult === "number" || !arrayValuesEqual(superwc, subresult)) {
                                retv = false;
                            }
                        }
                    }
                    if (retv === null) {
                        retv = r !== null;
                    }
                    if (retv === true && r !== null) {
                        pair.subtype = r;
                        pair.superwc = pair.superwc.slice(1);
                    }
                    return;
                } else {
                    if (!(pair.subtype.length > 0 && pair.subtype[0] === pair.supertype[0])) {
                        retv = false;
                        return;
                    }
                    pair.supertype = pair.supertype.slice(1);
                    pair.subtype = pair.subtype.slice(1);
                }
            } else {
                if (!parseSubset(parser, innerScope, pair)) {
                    retv = false;
                    return;
                }
            }
        } else if (pair.supertype.length > 0 && "identifier" in argument) {
            if (!(pair.subtype.length > 0 && pair.subtype[0] === pair.supertype[0])) {
                retv = false;
                return;
            }
            pair.supertype = pair.supertype.slice(1);
            pair.subtype = pair.subtype.slice(1);
        } else if (pair.supertype.length > 0 && "positiveint" in argument) {
            if (!(pair.subtype.length > 0 && pair.subtype[0] === pair.supertype[0] && parseInt(pair.subtype[0]) >= 0)) {
                retv = false;
                return;
            }
            pair.supertype = pair.supertype.slice(1);
            pair.subtype = pair.subtype.slice(1);
        } else {
            retv = false;
        }
    });
    if (retv === null) {
        return true;
    }
    return retv;
}

let expected: string | null = null;
let tests_total: number = 0;
let tests_passed: number = 0;

function execCommand(command: string[]): void {
    let nextExpected: string | null = null;
    const commands: { [key: string]: (params: string[]) => string } = {
        "PARSE": (params: string[]) => {
            console.time("command");
            try {
                const preparseResult = preparse(params);
                const parseResult = parsePretty(typeParser, "Type", preparseResult.sentence);
                console.log("ok: " + parseResult.ok);
                console.log("wildcardMap: " + preparseResult.wildcardMap);
                console.log(parseResult.result.join(" "));
            } catch (e) {
                if (!(e instanceof TypeParseError)) {
                    throw e;
                }
                console.error(e.name + ": " + e.message);
            } finally {
                console.timeEnd("command");
            }
            return "";
        },
        "ECHO": (params: string[]) => {
            console.log(params);
            return params.join(' ');
        },
        "EXIT": (_: string[]) => {
            process.exit(0);
        },
        "ASSERT": (params: string[]) => {
            nextExpected = params.join(' ');
            return "";
        },
        "SUBTYPE": (params: string[]) => {
            let result: string = "";
            console.time("command");
            try {
                const keywordIdx: number = params.indexOf("IN");
                if (keywordIdx === -1) {
                    console.log("Usage: SUBTYPE <subtype> IN <supertype>")
                } else {
                    let subData = preparse(params.slice(0, keywordIdx));
                    let superData = preparse(params.slice(keywordIdx + 1));
                    const pair: SigPair = {
                        subtype: subData.sentence,
                        subwc: subData.wildcardMap,
                        supertype: superData.sentence,
                        superwc: superData.wildcardMap,
                        wildcards: new Array<number | string[]>()
                    }
                    const p1: boolean = parseSubset(typeParser, "Type", pair);
                    const p2: boolean = pair.subtype.length === 0 && pair.supertype.length === 0;
                    console.log(p1 && p2);
                    result = (p1 && p2) ? "TRUE" : "FALSE";
                    if (!p2) {
                        console.log("Trailing data detected:")
                        console.log("  subtype: " + pair.subtype);
                        console.log("  supertype: " + pair.supertype);
                    }
                }
            } catch (e) {
                if (!(e instanceof TypeParseError)) {
                    throw e;
                }
                console.error(e.name + ": " + e.message);
            } finally {
                console.timeEnd("command");
            }
            return result;
        }
    }
    const cmdName: string = command[0];
    const params: string[] = command.slice(1);
    if (cmdName in commands) {
        const received = commands[cmdName](params);
        if (expected !== null) {
            console.log(`Assertion for ${JSON.stringify(params.join(" "))} is ${expected === received ? "passed" : "failed"}`);
            if (expected !== received) {
                console.log(`  expected: ${expected}`);
                console.log(`  received: ${received}`);
            } else {
                tests_passed++;
            }
            tests_total++;
        }
        expected = nextExpected;
    } else {
        console.log("Available commands: ")
        console.log("  " + Object.keys(commands).join(", "))
    }
}

process.stdin.on('readable', () => {
    let chunk: Buffer;
    while (null !== (chunk = process.stdin.read())) {
        const chunkStr: string = chunk.toString("utf8").trim();
        chunkStr.split('\n').forEach((line) => {
            if (line === "") {
                return;
            }
            execCommand(line.split(' '));
        })
    }
})

process.on('beforeExit', () => {
    if (tests_total > 0) {
        console.log(`Total tests: ${tests_total}`)
        console.log(` Passed: ${tests_passed}`)
        console.log(` Failed: ${tests_total - tests_passed}`)
    }
})
