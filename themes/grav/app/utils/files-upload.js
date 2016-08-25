import $ from 'jquery';
import Dropzone from 'dropzone';
import request from './request';
import { config, translations } from 'grav-config';

Dropzone.autoDiscover = false;
Dropzone.options.gravPageDropzone = {};
Dropzone.confirm = (question, accepted, rejected) => {
    let doc = $(document);
    let modalSelector = '[data-remodal-id="delete-media"]';

    let removeEvents = () => {
        doc.off('confirmation', modalSelector, accept);
        doc.off('cancellation', modalSelector, reject);

        $(modalSelector).find('.remodal-confirm').removeClass('pointer-events-disabled');
    };

    let accept = () => {
        accepted && accepted();
        removeEvents();
    };

    let reject = () => {
        rejected && rejected();
        removeEvents();
    };

    $.remodal.lookup[$(modalSelector).data('remodal')].open();
    doc.on('confirmation', modalSelector, accept);
    doc.on('cancellation', modalSelector, reject);
};

const DropzoneMediaConfig = {
    createImageThumbnails: { thumbnailWidth: 150 },
    addRemoveLinks: false,
    dictDefaultMessage: translations.PLUGIN_ADMIN.DROP_FILES_HERE_TO_UPLOAD,
    dictRemoveFileConfirmation: '[placeholder]',
    previewTemplate: `
        <div class="dz-preview dz-file-preview">
          <div class="dz-details">
            <div class="dz-filename"><span data-dz-name></span></div>
            <div class="dz-size" data-dz-size></div>
            <img data-dz-thumbnail />
          </div>
          <div class="dz-progress"><span class="dz-upload" data-dz-uploadprogress></span></div>
          <div class="dz-success-mark"><span>✔</span></div>
          <div class="dz-error-mark"><span>✘</span></div>
          <div class="dz-error-message"><span data-dz-errormessage></span></div>
          <a class="dz-remove file-thumbnail-remove" href="javascript:undefined;" data-dz-remove><i class="fa fa-fw fa-close"></i></a>
        </div>`.trim()
};

export default class FilesUpload {
    constructor({ container = '.dropzone.files-upload', options = {} } = {}) {
        this.container = $(container);
        if (!this.container.length) { return; }

        this.options = Object.assign({}, DropzoneMediaConfig, {
            klass: this,
            url: this.container.data('file-url-add') || config.current_url,
            acceptedFiles: this.container.data('media-types'),
            init: this.initDropzone
        }, this.container.data('dropzone-options'), options);

        this.dropzone = new Dropzone(container, this.options);
        this.dropzone.on('complete', this.onDropzoneComplete.bind(this));
        this.dropzone.on('success', this.onDropzoneSuccess.bind(this));
        this.dropzone.on('removedfile', this.onDropzoneRemovedFile.bind(this));
        this.dropzone.on('sending', this.onDropzoneSending.bind(this));
        this.dropzone.on('error', this.onDropzoneError.bind(this));
    }

    initDropzone() {
        let files = this.options.klass.container.find('[data-file]');
        let dropzone = this;
        if (!files.length) { return; }

        files.each((index, file) => {
            file = $(file);
            let data = file.data('file');
            let mock = {
                name: data.name,
                size: data.size,
                type: data.type,
                status: Dropzone.ADDED,
                accepted: true,
                url: this.options.url,
                removeUrl: data.remove
            };

            dropzone.files.push(mock);
            dropzone.options.addedfile.call(dropzone, mock);
            if (mock.type.match(/^image\//)) dropzone.options.thumbnail.call(dropzone, mock, data.path);

            file.remove();
        });
    }

    onDropzoneSending(file, xhr, formData) {
        formData.append('name', this.options.dotNotation);
        formData.append('admin-nonce', config.admin_nonce);
        formData.append('task', 'filesupload');
    }

    onDropzoneSuccess(file, response, xhr) {
        if (this.options.reloadPage) {
            global.location.reload();
        }

        return this.handleError({
            file,
            data: response,
            mode: 'removeFile',
            msg: `<p>${translations.PLUGIN_ADMIN.FILE_ERROR_UPLOAD} <strong>${file.name}</strong></p>
            <pre>${response.message}</pre>`
        });
    }

    onDropzoneComplete(file) {
        if (!file.accepted && !file.rejected) {
            let data = {
                status: 'error',
                message: `${translations.PLUGIN_ADMIN.FILE_UNSUPPORTED}: ${file.name.match(/\..+/).join('')}`
            };

            return this.handleError({
                file,
                data,
                mode: 'removeFile',
                msg: `<p>${translations.PLUGIN_ADMIN.FILE_ERROR_ADD} <strong>${file.name}</strong></p>
                <pre>${data.message}</pre>`
            });
        }

        if (this.options.reloadPage) {
            global.location.reload();
        }
    }

    onDropzoneRemovedFile(file, ...extra) {
        if (!file.accepted || file.rejected) { return; }
        let url = file.removeUrl || this.urls.delete;

        request(url, {
            method: 'post',
            body: {
                filename: file.name
            }
        });
    }

    onDropzoneError(file, response, xhr) {
        let message = xhr ? response.error.message : response;
        $(file.previewElement).find('[data-dz-errormessage]').html(message);

        return this.handleError({
            file,
            data: { status: 'error' },
            msg: `<pre>${message}</pre>`
        });
    }

    handleError(options) {
        let { file, data, mode, msg } = options;
        if (data.status !== 'error' && data.status !== 'unauthorized') { return; }

        switch (mode) {
            case 'addBack':
                if (file instanceof File) {
                    this.dropzone.addFile.call(this.dropzone, file);
                } else {
                    this.dropzone.files.push(file);
                    this.dropzone.options.addedfile.call(this.dropzone, file);
                    this.dropzone.options.thumbnail.call(this.dropzone, file, file.extras.url);
                }

                break;
            case 'removeFile':
            default:
                if (~this.dropzone.files.indexOf(file)) {
                    file.rejected = true;
                    this.dropzone.removeFile.call(this.dropzone, file, { silent: true });
                }

                break;
        }

        let modal = $('[data-remodal-id="generic"]');
        modal.find('.error-content').html(msg);
        $.remodal.lookup[modal.data('remodal')].open();
    }
}

export function UriToMarkdown(uri) {
    uri = uri.replace(/@3x|@2x|@1x/, '');
    uri = uri.replace(/\(/g, '%28');
    uri = uri.replace(/\)/g, '%29');

    return uri.match(/\.(jpe?g|png|gif|svg)$/i) ? `![](${uri})` : `[${decodeURI(uri)}](${uri})`;
}

export let Instances = (() => {
    let instances = [];
    $('.dropzone.files-upload').each((i, container) => {
        container = $(container);
        let input = container.find('input[type="file"]');
        let settings = JSON.parse(global.atob(container.data('settings') || '{}'));

        if (settings.accept && ~settings.accept.indexOf('*')) {
            settings.accept = [''];
        }

        let options = {
            url: container.data('file-url-add') || (container.closest('form').attr('action') || config.current_url) + '.json',
            paramName: settings.paramName || 'file',
            dotNotation: settings.name || 'file',
            acceptedFiles: settings.accept ? settings.accept.join(',') : input.attr('accept') || container.data('media-types'),
            maxFilesize: settings.filesize || 256,
            maxFiles: settings.limit || null
        };

        container = container[0];
        instances.push(new FilesUpload({ container, options }));
    });

    return instances;
})();