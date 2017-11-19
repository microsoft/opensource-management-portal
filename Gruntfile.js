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
    less: {
      dist: {
        options: {
          compress: false,
          strictMath: true
        },
        files: {}
      }
    },
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
            cwd: 'node_modules/bootstrap/dist/',
            dest: '<%= buildrootdir %>',
          },
        ]
      },
      typeaheadjs: {
        files: [
          {
            expand: true,
            src: '**',
            cwd: 'node_modules/typeahead.js/dist/',
            dest: '<%= buildscriptdir %>',
          },
        ]
      },
      typeaheadjsBootstrapPatch: {
        files: [
          {
            expand: true,
            src: '*.less',
            cwd: 'node_modules/typeahead.js-bootstrap3.less/',
            dest: 'resources/less/',
          },
        ]
      },
      octicons: {
        files: [
          {
            expand: true,
            src: '**',
            cwd: 'node_modules/octicons/build/',
            dest: '<%= builddir %>',
          },
        ]
      },
      jquery: {
        files: [
          {
            expand: true,
            src: '**',
            cwd: 'node_modules/jquery/dist/',
            dest: '<%= buildscriptdir %>',
          },
        ]
      },
      resources: {
        files: [
          {
            expand: true,
            src: '**',
            cwd: 'resources/',
            dest: '<%= buildrootdir %>',
          },
        ]
      },
      timeago: {
        files: [
          {
            expand: true,
            src: 'jquery.timeago.js',
            cwd: 'node_modules/timeago/',
            dest: '<%= buildscriptdir %>',
          },
        ]
      },
      d3: {
        files: [
          {
            expand: true,
            src: 'd3.min.js',
            cwd: 'node_modules/d3/',
            dest: '<%= buildscriptdir %>',
          },
        ]
      },
      c3: {
        files: [
          {
            expand: true,
            src: 'c3.min.css',
            cwd: 'node_modules/c3/',
            dest: '<%= builddir %>',
          },
          {
            expand: true,
            src: 'c3.min.js',
            cwd: 'node_modules/c3/',
            dest: '<%= buildscriptdir %>',
          },
        ]
      },
    },
    clean: {
      build: {
        src: ['*/build.scss', '*/build.less']
      }
    }
  });

  grunt.registerTask('none', function () { });

  grunt.registerTask('build_less', 'build a regular theme from less', function() {
    var theme = 'resources/less';
    var compress = true;

    var concatSrc;
    var concatDest;
    var lessDest;
    var lessSrc;
    var files = {};
    var dist = {};
    concatSrc = theme + '/_build.less';
    concatDest = theme + '/build.less';
    lessDest = '<%=builddir%>/bootstrap.css';
    lessSrc = [ theme + '/' + 'build.less' ];

    dist = {src: concatSrc, dest: concatDest};
    grunt.config('concat.dist', dist);
    files = {};
    files[lessDest] = lessSrc;
    grunt.config('less.dist.files', files);
    grunt.config('less.dist.options.compress', false);

    grunt.task.run(['concat', 'less:dist', /*'prefix:' + lessDest,*/ 'clean:build',
      compress ? 'compress:'+lessDest+':'+'<%=builddir%>/bootstrap.min.css':'none']);
  });

  grunt.registerTask('compress', 'compress a generic css', function(fileSrc, fileDst) {
    var files = {};
    files[fileDst] = fileSrc;
    grunt.log.writeln('compressing file ' + fileSrc);

    grunt.config('less.dist.files', files);
    grunt.config('less.dist.options.compress', true);
    grunt.task.run(['less:dist']);
  });

  grunt.registerTask('default', ['copy', 'build_less']);
};
