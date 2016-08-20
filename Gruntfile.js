//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

module.exports = function (grunt) {
  grunt.loadNpmTasks('grunt-contrib-sass');
  grunt.loadNpmTasks('grunt-contrib-concat');
  grunt.loadNpmTasks('grunt-contrib-clean');

  grunt.initConfig({
    pkg: grunt.file.readJSON('package.json'),
    builddir: 'public/testing',
    banner: '/*!\n' +
            ' * <%= pkg.name %> v<%= pkg.version %>\n' +
            ' * Homepage: <%= pkg.homepage %>\n' +
            ' * Copyright 2012-<%= grunt.template.today("yyyy") %> <%= pkg.author %>\n' +
            ' * Licensed under <%= pkg.license %>\n' +
            ' * Based on Bootstrap\n' +
            '*/\n',
    clean: {
      build: {
        src: ['*/build.scss', '!global/build.scss']
      }
    },
  });

  grunt.registerTask('none', function() {});

  grunt.registerTask('build_scss', 'build a regular theme from scss', function() {
    var theme = 'bower_components/bootswatch/cosmo/';
    var compress = true;

    var isValidTheme = grunt.file.exists(theme, '_variables.scss') && grunt.file.exists(theme, '_bootswatch.scss');

     // cancel the build (without failing) if this directory is not a valid theme
    if (!isValidTheme) {
      return;
    }
    var concatSrc;
    var concatDest;
    var scssDest;
    var scssSrc;
    var files = {};
    var dist = {};
    concatSrc = 'theme/build.scss';
    concatDest = theme + '/build.scss';
    scssDest = '<%=builddir%>/' + theme + '/bootstrap.css';
    scssSrc = [theme + '/' + 'build.scss'];

    dist = {src: concatSrc, dest: concatDest};
    grunt.config('concat.dist', dist);
    files = {};
    files[scssDest] = scssSrc;
    grunt.config('sass.dist.files', files);
    grunt.config('sass.dist.options.style', 'expanded');
    grunt.config('sass.dist.options.precision', 8);
    grunt.config('sass.dist.options.unix-newlines', true);
 
    grunt.task.run(['concat', 'sass:dist', 'prefix:' + scssDest, 'clean:build',
        compress ? 'compress_scss:' + scssDest + ':' + '<%=builddir%>/' + theme + '/bootstrap.min.css' : 'none']);
  });
  
};