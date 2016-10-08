//////////////////////////////////////////////////////////////////////////////////////
//
//  The MIT License (MIT)
//
//  Copyright (c) 2015-present, Dom Chen.
//  All rights reserved.
//
//  Permission is hereby granted, free of charge, to any person obtaining a copy of
//  this software and associated documentation files (the "Software"), to deal in the
//  Software without restriction, including without limitation the rights to use, copy,
//  modify, merge, publish, distribute, sublicense, and/or sell copies of the Software,
//  and to permit persons to whom the Software is furnished to do so, subject to the
//  following conditions:
//
//      The above copyright notice and this permission notice shall be included in all
//      copies or substantial portions of the Software.
//
//  THE SOFTWARE IS PROVIDED *AS IS*, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
//  INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
//  PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
//  HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
//  OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
//  SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
//
//////////////////////////////////////////////////////////////////////////////////////

import * as path from "path";
import * as ts from "typescript";

const defaultFormatDiagnosticsHost:ts.FormatDiagnosticsHost = {
    getCurrentDirectory: () => ts.sys.getCurrentDirectory(),
    getNewLine: () => ts.sys.newLine,
    getCanonicalFileName: createGetCanonicalFileName(ts.sys.useCaseSensitiveFileNames)
};

function createGetCanonicalFileName(useCaseSensitivefileNames:boolean):(fileName:string) => string {
    return useCaseSensitivefileNames
        ? ((fileName) => fileName)
        : ((fileName) => fileName.toLowerCase());
}

function run(args:string[]):void {
    let searchPath = ts.sys.getCurrentDirectory();
    let configFileName = findConfigFile(searchPath);
    let result = ts.parseConfigFileTextToJson(configFileName, ts.sys.readFile(configFileName));
    const configObject = result.config;
    if (!configObject) {
        ts.sys.write(ts.formatDiagnostics([result.error], defaultFormatDiagnosticsHost));
        ts.sys.exit(1);
        return;
    }
    let baseDir = path.dirname(configFileName);
    let optionResult = ts.convertCompilerOptionsFromJson(configObject["compilerOptions"], baseDir, configFileName);
    if (optionResult.errors.length > 0) {
        ts.sys.write(ts.formatDiagnostics(optionResult.errors, defaultFormatDiagnosticsHost));
        ts.sys.exit(1);
        return;
    }
    let compilerOptions = optionResult.options;
    compilerOptions.declaration = true;
    compilerOptions.module = ts.ModuleKind.None;
    let packerOptions = convertPackerOptionsFromJson(configObject["packerOptions"], baseDir);
    let modules:tspack.ModuleConfig[] = configObject["modules"];
    formatDependencies(modules, packerOptions);
    modules.forEach(moduleConfig=> {
        compileModule(moduleConfig, packerOptions, compilerOptions);
    })
}

function getModuleFileName(moduleConfig:tspack.ModuleConfig, packerOptions:tspack.PackerOptions):string {
    if (moduleConfig.outFile) {
        let baseDir = packerOptions.projectDir;
        if (moduleConfig.baseDir) {
            baseDir = path.join(baseDir, moduleConfig.baseDir);
        }
        return path.join(baseDir, moduleConfig.outFile);
    }
    let outDir:string = packerOptions.outDir ? packerOptions.outDir : packerOptions.projectDir;
    return path.join(outDir, moduleConfig.name + ".js");
}

function findConfigFile(searchPath:string):string {
    while (true) {
        let fileName = path.join(searchPath, "tspack.json");
        if (ts.sys.fileExists(fileName)) {
            return fileName;
        }
        let parentPath = path.dirname(searchPath);
        if (parentPath === searchPath) {
            break;
        }
        searchPath = parentPath;
    }
    return undefined;
}

function convertPackerOptionsFromJson(json:any, baseDir:string):tspack.PackerOptions {
    let options:tspack.PackerOptions = {};
    options.projectDir = baseDir;
    if (!json) {
        return options;
    }
    if (json["outDir"]) {
        options.outDir = json["outDir"];
        options.outDir = path.join(baseDir, options.outDir);
    }
    return options;
}

function formatDependencies(moduleConfigs:tspack.ModuleConfig[], packerOptions:tspack.PackerOptions):void {
    var tsdMap:{[key:string]:string} = {};
    moduleConfigs.forEach(moduleConfig=> {
        let outFile = moduleConfig.outFile = getModuleFileName(moduleConfig, packerOptions);
        if (outFile.substr(outFile.length - 3).toLowerCase() == ".js") {
            outFile = outFile.substr(0, outFile.length - 3);
        }
        tsdMap[moduleConfig.name] = outFile + ".d.ts";
    });
    moduleConfigs.forEach(moduleConfig=> {
        if (isArray(moduleConfig.dependencies)) {
            let dependencies = moduleConfig.dependencies;
            for (let i = 0; i < dependencies.length; i++) {
                let tsd = tsdMap[dependencies[i]];
                if (!tsd) {
                    ts.sys.write("error tspack.json: Could not find the name of dependency: " + dependencies[i] + ts.sys.newLine);
                    ts.sys.exit(1);
                }
                dependencies[i] = tsd;
            }
        }
        else {
            moduleConfig.dependencies = [];
        }
    });
}

function isArray(value:any):value is any[] {
    return Array.isArray ? Array.isArray(value) : value instanceof Array;
}

function compileModule(moduleConfig:tspack.ModuleConfig, packerOptions:tspack.PackerOptions, compilerOptions:ts.CompilerOptions):void {
    compilerOptions.outFile = moduleConfig.outFile;
    let fileNames = getFileNames(moduleConfig, packerOptions.projectDir);
    let program = ts.createProgram(fileNames, compilerOptions);
    let emitResult = program.emit();
    let allDiagnostics = ts.getPreEmitDiagnostics(program).concat(emitResult.diagnostics);
    if (allDiagnostics.length == 0) {
        return;
    }
    allDiagnostics.forEach(diagnostic => {
        ts.sys.write(ts.formatDiagnostics([diagnostic], defaultFormatDiagnosticsHost));
    });

    let exitCode = emitResult.emitSkipped ? 1 : 0;
    console.log(`Process exiting with code '${exitCode}'.`);
    process.exit(exitCode);
}

function getFileNames(moduleConfig:tspack.ModuleConfig, baseDir):string[] {
    if (moduleConfig.baseDir) {
        baseDir = path.join(baseDir, moduleConfig.baseDir);
    }
    let optionResult = ts.parseJsonConfigFileContent(moduleConfig, ts.sys, baseDir);
    if (optionResult.errors.length > 0) {
        ts.sys.write(ts.formatDiagnostics(optionResult.errors, defaultFormatDiagnosticsHost));
        ts.sys.exit(1);
        return;
    }
    let fileNames = optionResult.fileNames;
    if (moduleConfig.dependencies) {
        fileNames = fileNames.concat(moduleConfig.dependencies);
    }
    return fileNames;
}


run(ts.sys.args);