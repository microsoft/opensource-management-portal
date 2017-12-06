//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["warn", "log", "dir"] }] */

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
            cwd: 'bower_components/bootstrap/dist/',
            dest: '<%= buildrootdir %>',
          },
        ]
      },
      typeaheadjs: {
        files: [
          {
            expand: true,
            src: '**',
            cwd: 'bower_components/typeahead.js/dist/',
            dest: '<%= buildscriptdir %>',
          },
        ]
      },
      typeaheadjsBootstrapPatch: {
        files: [
          {
            expand: true,
            src: '*.less',
            cwd: 'bower_components/typeahead.js-bootstrap3.less/',
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
            cwd: 'bower_components/jQuery/dist/',
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
      d3: {
        files: [
          {
            expand: true,
            src: 'd3.min.js',
            cwd: 'bower_components/d3/',
            dest: '<%= buildscriptdir %>',
          },
        ]
      },
      c3: {
        files: [
          {
            expand: true,
            src: 'c3.min.css',
            cwd: 'bower_components/c3/',
            dest: '<%= builddir %>',
          },
          {
            expand: true,
            src: 'c3.min.js',
            cwd: 'bower_components/c3/',
            dest: '<%= buildscriptdir %>',
          },
        ]
      },
    },
    clean: {
      build: {
        src: ['*/build.scss', '*/build.less']
      }
    },
    exec: {
      ember_test: {
        cwd: 'client',
        command: 'ember test'
      },
      ember_build: {
        cwd: 'client',
        command: 'ember build --environment=production --output-path=../public/client/'
      }
    },
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

  grunt.registerTask('bower', 'Installing bower dependencies', function() {
    var bower = require('bower');
    var done = this.async();
    bower.commands.install().on('log', function(result) {
      grunt.log.writeln('bower ' + result.id + ' ' + result.message);
    }).on('error', function(error) {
      console.dir(error);
      done(false);
    }).on('end', function() {
      done();
    });
  });

  grunt.registerTask('client:npm', 'install the client npm modules + ember-cli', function() {
    var exec = require('child_process').exec;
    var cb = this.async();
    exec('npm install -g ember-cli && npm install', {cwd: './client'}, function(err, stdout) {
      console.log(stdout);
      cb();
    });
  });

  grunt.registerTask('client:bower', 'Installing client bower dependencies', function() {
    var bower = require('bower');
    var done = this.async();
    bower.commands.install(null, null, {
      cwd: 'client',
    }).on('log', function(result) {
      grunt.log.writeln('bower ' + result.id + ' ' + result.message);
    }).on('error', function(error) {
      console.dir(error);
      done(false);
    }).on('end', function() {
      done();
    });
  });

  grunt.registerTask('client:build', [
    'client:bower',
    'client:npm',
    // 'exec:ember_test',
    'exec:ember_build',
  ]);

  grunt.registerTask('default', [
    'bower',
    'copy',
    'build_less',
    'exec:ember_test',
    'exec:ember_build',
  ]);

  grunt.registerTask('docker:prep', [
    'bower',
    'copy',
    'build_less',
    'client:build',
  ]);
};
