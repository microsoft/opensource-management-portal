//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

module.exports = function (grunt) {
  require('load-grunt-tasks')(grunt);

  grunt.initConfig({
    pkg: grunt.file.readJSON('package.json'),
    builddir: 'public/css',
    buildscriptdir: 'public/js/',
    buildrootdir: 'public/',
    banner: '/*!\n' +
    ' * <%= pkg.name %> v<%= pkg.version %>\n' +
    ' * Homepage: <%= pkg.homepage %>\n' +
    ' * Copyright 2012-<%= grunt.template.today("yyyy") %> <%= pkg.author %>\n' +
    ' * Licensed under <%= pkg.license %>\n' +
    ' * Based on Bootstrap\n' +
    '*/\n',
    concat: {
      options: {
        banner: '<%= banner %>',
        stripBanners: false
      },
      dist: {
        src: [],
        dest: ''
      }
    },
    copy: {
      bootstrap: {
        files: [
          {
            expand: true,
            src: '**',
            cwd: 'bower_components/bootstrap/dist/',
            dest: '<%= buildrootdir %>',
          },
        ]
      },
      html5shiv: {
        files: [
          {
            expand: true,
            src: '**',
            cwd: 'bower_components/html5shiv/dist/',
            dest: '<%= buildscriptdir %>',
          },
        ]
      },
      jquery: {
        files: [
          {
            expand: true,
            src: '**',
            cwd: 'bower_components/jQuery/dist/',
            dest: '<%= buildscriptdir %>',
          },
        ]
      },
      timeago: {
        files: [
          {
            expand: true,
            src: 'jquery.timeago.js',
            cwd: 'bower_components/jquery-timeago/',
            dest: '<%= buildscriptdir %>',
          },
        ]
      },
      uitablefilter: {
        files: [
          {
            expand: true,
            src: 'jquery.uitablefilter.js',
            cwd: 'bower_components/jquery-uitablefilter/',
            dest: '<%= buildscriptdir %>',
          },
        ]
      },
    },
    clean: {
      build: {
        src: ['*/build.scss', '!theme/build.scss']
      }
    },
  });

  grunt.registerTask('none', function () { });

  grunt.registerTask('build_scss', 'build a regular theme from scss', function() {
    var theme = 'theme';
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
    scssDest = '<%=builddir%>/bootstrap.css';
    scssSrc = [theme + '/' + 'build.scss'];

    dist = {src: concatSrc, dest: concatDest};
    grunt.config('concat.dist', dist);
    files = {};
    files[scssDest] = scssSrc;
    grunt.config('sass.dist.files', files);
    grunt.config('sass.dist.options.style', 'expanded');
    grunt.config('sass.dist.options.precision', 8);
    grunt.config('sass.dist.options.unix-newlines', true);

    grunt.task.run([/*'concat',*/ 'sass', /*'prefix:' + scssDest,*/ 'clean:build',
        compress ? 'compress_scss:' + scssDest + ':' + '<%=builddir%>/bootstrap.min.css' : 'none']);
  });

  grunt.registerTask('compress_scss', 'compress a generic css with sass', function(fileSrc, fileDst) {
    var files = {}; files[fileDst] = fileSrc;
    grunt.log.writeln('compressing file ' + fileSrc);

    grunt.config('sass.dist.files', files);
    grunt.config('sass.dist.options.style', 'compressed');
    grunt.task.run(['sass:dist']);
  });

  grunt.registerTask('default', ['build_scss', 'copy']);
};
