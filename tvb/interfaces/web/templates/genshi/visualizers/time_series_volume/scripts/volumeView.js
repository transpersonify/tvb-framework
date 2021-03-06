/* globals displayMessage */

/**
 * Code that is responsible with drawing volumetric information.
 * It is a strict view. It does not keep the volumetric slices that it displays nor the current selected voxel.
 * Those responsibilities belong to the timeseriesVolume.js controller.
 *
 */

var Quadrant = function (params){                // this keeps all necessary data for drawing
    this.index = params.index || 0;                // in a quadrant
    this.axes = params.axes || {x: 0, y: 1};       // axes represented in current quad; i=0, j=1, k=2
    this.entityWidth = params.entityWidth || 0;    // width and height of one voxel in current quad
    this.entityHeight = params.entityHeight || 0;
    this.offsetX = params.offsetX || 0;            // the offset of the drawing relative to the quad
    this.offsetY = params.offsetY || 0;
};

(function(){ // module volumeView
/**
 * Keeps the ui state and read only contextual information associated with this view.
 */
var vol = {
    ctx: null,                  // The context for drawing on current canvas.
    backCtx: null,              // The context of the offscreen canvas.

    currentQuadrant: 0,         // The quadrant we're in.
    highlightedQuad: {},        // The plane to be displayed on the focus quadrant
    quadrants: [],              // The quadrants array.
    minimumValue: null,         // Minimum value of the dataset.
    maximumValue: null,         // Maximum value of the dataset.
    voxelSize: null,
    quadrantHeight: null,       // The height of the three small left quadrants
    quadrantWidth: null,        // The width of the three small left quadrants
    focusQuadrantHeight: null,  // The height of the focus quadrant
    focusQuadrantWidth: null,   // The width of the focus quadrant
    legendHeight: 0,            // The height of the legend quadrant
    legendWidth: 0,             // The width of the legend quadrant
    legendPadding:80*2,         // Horizontal padding for the TSV viewr legend
    volumeOrigin: null,         // VolumeOrigin is not used for now. if needed, use it in _setQuadrant

    dataSize: "",               // Used first to contain the file ID and then it's dimension.
    currentColorScale: null     // The color scale used for the current draw call
};

/**
 * Initializes the volume view.
 * The dimensions of the volume are given by dataSize.
 * The interval in which the signal varies is [minValue .. maxValue]. This is used by the color scale. Not per slice.
 */
function TSV_initVolumeView(dataSize, minValue, maxValue, voxelSize, volumeOrigin){
    var canvas = document.getElementById("canvasVolumes");
    if (!canvas.getContext){
        displayMessage('You need a browser with canvas capabilities, to see this demo fully!', "errorMessage");
        return;
    }

    canvas.height = $(canvas).parent().height();
    canvas.width  = $(canvas).parent().width();

    var tmp = Math.floor(canvas.height / 3);
    vol.quadrantHeight = tmp;       // quadrants are squares
    vol.quadrantWidth = tmp;
    vol.focusQuadrantWidth = canvas.width - vol.quadrantWidth;
    vol.legendHeight = canvas.height / 13;
    vol.legendWidth = vol.focusQuadrantWidth - vol.legendPadding;
    vol.focusQuadrantHeight = canvas.height - vol.legendHeight;

    vol.ctx = canvas.getContext("2d");
    // This is an off screen canvas. We draw to it with fast pixel manipulation routines.
    // Then we paste the backCanvas to the on screen one with drawImage.
    // drawImage does perform alpha compositing and coordinate transforms allowing us to implement layers.
    var backCanvas = document.createElement("canvas");
    // debug back canvas by inserting it into dom
    //$(backCanvas).css({position: 'absolute', right: 0, top:'100px', border:'1px solid yellow'});
    //$('body').append(backCanvas);
    vol.backCtx = backCanvas.getContext("2d");
    // Making images bigger before saving is not so useful when dealing with pixel data (volumetric part)
    // or vector data (series part).
    canvas.drawForImageExport = function() {};

    vol.dataSize = dataSize;
    vol.minimumValue = minValue;
    vol.maximumValue = maxValue;
    vol.voxelSize = voxelSize;
    vol.volumeOrigin = volumeOrigin;

    _setupQuadrants();
    vol.highlightedQuad = vol.quadrants[0];
    _setupFocusQuadrant(vol.quadrants[0]);
}

/**
 * Draws a volume slice.
 * @param layers A list of layers. A layer {sliceArray:, colorScale: }
 *        sliceArray is [axial, sagittal, coronal] where elements are 2d array slices.
 * @param selectedEntity The selected voxel. A cross will be drawn over it.
 */
function TSV_drawVolumeScene(layers, selectedEntity){
    vol.currentColorScale = layers[0].colorScale;
    clearCanvas();

    for (var i = 0; i < layers.length; ++i) {
        vol.currentColorScale = layers[i].colorScale;
        drawSmallQuadrants(layers[i].sliceArray);
        drawFocusQuadrantFromView(layers[i].sliceArray);
    }

    drawMargins();
    drawNavigator(selectedEntity);
    //Value of the selected voxel is taken from the last layer. Used to highlight value in color scale.
    var lastSliceArray = layers[layers.length - 1].sliceArray;
    var selectedEntityValue = lastSliceArray[0][selectedEntity[0]][selectedEntity[1]];
    drawLegend(selectedEntityValue);
    var focusTxt = selectedEntity+"="+selectedEntityValue.toPrecision(3);
    drawLabels(focusTxt);
}

/**
 * May be called multiple times to draw different volumetric layers with transparent parts.
 */
function drawSmallQuadrants(sliceArray){
    // Set the back canvas size to the small quadrant. This also clears it.
    vol.backCtx.canvas.width = vol.quadrantWidth;
    vol.backCtx.canvas.height = vol.quadrantHeight;

    _setCtxOnQuadrant(0);
    _drawAxial(sliceArray);
    _setCtxOnQuadrant(1);
    _drawSagittal(sliceArray);
    _setCtxOnQuadrant(2);
    _drawCoronal(sliceArray);
}

/**
 * Draws the selectedQuadrant on Focus Quadrant from the xyz planes data.
 */
function drawFocusQuadrantFromView(sliceArray){
    _setCtxOnQuadrant(3);
    vol.backCtx.canvas.width = vol.focusQuadrantWidth;
    vol.backCtx.canvas.height = vol.focusQuadrantHeight;

    if(vol.highlightedQuad.index === 0){
        _drawAxial(sliceArray);
    } else if(vol.highlightedQuad.index === 1){
        _drawSagittal(sliceArray);
    } else if(vol.highlightedQuad.index === 2){
        _drawCoronal(sliceArray);
    }
}

/**
 * Create an off screen buffer for fast pixel manipulation on the current quadrant.
 */
function _createImgData(w_voxels, h_voxels){
    // The dimensions of the off screen buffer are not focusQuadrantWidth but smaller
    // because the volumetric slice is smaller than the quadrant.
    // Using focusQuadrantWidth will lead to some visual glitches.
    // Underlying issue is signal-pixel aliasing
    return vol.backCtx.createImageData(Math.round(w_voxels * (1 + vol.currentQuadrant.entityWidth)),
                                       Math.round(h_voxels * (1 + vol.currentQuadrant.entityHeight)));
}

/** draws the axial slice on the current quadrant */
function _drawAxial(sliceArray){
    // Create an off screen buffer for fast pixel manipulation.
    var imageData = _createImgData(vol.dataSize[1], vol.dataSize[2]);

    for (var j = 0; j < vol.dataSize[2]; ++j){
        for (var i = 0; i < vol.dataSize[1]; ++i){
            drawVoxel(imageData, i, j, sliceArray[0][i][j]);
        }
    }
    // Now paste the buffer to the back canvas
    vol.backCtx.putImageData(imageData, 0, 0);
    // Finally paste the back canvas to the foreground one
    // This performs alpha compositing and is the reason for this 'two step paste' drawing
    vol.ctx.drawImage(vol.backCtx.canvas, 0, 0);
}

function _drawSagittal(sliceArray){
    var imageData = _createImgData(vol.dataSize[2], vol.dataSize[3]);
    for (var k = 0; k < vol.dataSize[3]; ++k){
        for (var j = 0; j < vol.dataSize[2]; ++j){
            drawVoxel(imageData, k, j, sliceArray[1][j][k]);
        }
    }
    vol.backCtx.putImageData(imageData, 0, 0);
    vol.ctx.drawImage(vol.backCtx.canvas, 0, 0);
}

function _drawCoronal(sliceArray){
    var imageData = _createImgData(vol.dataSize[1], vol.dataSize[3]);
    for (var k = 0; k < vol.dataSize[3]; ++k){
        for (var i = 0; i < vol.dataSize[1]; ++i){
            drawVoxel(imageData, k, i, sliceArray[2][i][k]);
        }
    }
    vol.backCtx.putImageData(imageData, 0, 0);
    vol.ctx.drawImage(vol.backCtx.canvas, 0, 0);
}

/**
 * Draws the voxel set at (line, col) in the current quadrant, and colors it
 * according to its value.
 * This function know nothing about the time point.
 * This draws on an off screen binary buffer.
 * @param imageData The destination ImageData buffer
 * @param line THe vertical line of the grid we wish to draw on
 * @param col The horizontal line of the grid we wish to draw on
 * @param value The value of the voxel that will be converted into color
 */
function drawVoxel(imageData, line, col, value){
    // imaging api is less tolerant of float dimensions so we round
    var x = Math.round(col * vol.currentQuadrant.entityWidth);
    var y = Math.round(line * vol.currentQuadrant.entityHeight);
    var w = Math.round(vol.currentQuadrant.entityWidth + 1);
    var h = Math.round(vol.currentQuadrant.entityHeight + 1);

    var rgba = vol.currentColorScale.getColor(value);
    // A fillRect on the imageData:
    for (var yi = y; yi < y + h; ++yi) {
        var stride = yi * imageData.width;
        for (var xi = x; xi < x + w; ++xi) {
            var i = (stride + xi) * 4;
            imageData.data[i] = rgba[0] * 255;
            imageData.data[i + 1] = rgba[1] * 255;
            imageData.data[i + 2] = rgba[2] * 255;
            imageData.data[i + 3] = rgba[3] * 255;
        }
    }
}

/**
 * Draws the cross-hair on each quadrant, on the <code>selectedEntity</code>
 */
function drawNavigator(selectedEntity){
    // Preview quadrans navigators
    vol.ctx.save();
    vol.ctx.beginPath();

    for (var quadIdx = 0; quadIdx < 3; ++quadIdx){
        _setCtxOnQuadrant(quadIdx);
        var x = selectedEntity[vol.currentQuadrant.axes.x] * vol.currentQuadrant.entityWidth + vol.currentQuadrant.entityWidth / 2;
        var y = selectedEntity[vol.currentQuadrant.axes.y] * vol.currentQuadrant.entityHeight + vol.currentQuadrant.entityHeight / 2;
        drawCrossHair(x, y);
    }
    vol.ctx.strokeStyle = "red";
    vol.ctx.lineWidth = 3;
    vol.ctx.stroke();
    vol.ctx.restore();

    // Focus quadrant Navigator
    vol.ctx.save();
    vol.ctx.beginPath();

    _setCtxOnQuadrant(3);
    var xx = selectedEntity[vol.currentQuadrant.axes.x] * vol.currentQuadrant.entityWidth + vol.currentQuadrant.entityWidth / 2;
    var yy = selectedEntity[vol.currentQuadrant.axes.y] * vol.currentQuadrant.entityHeight + vol.currentQuadrant.entityHeight / 2;
    drawFocusCrossHair(xx, yy);

    vol.ctx.strokeStyle = "blue";
    vol.ctx.lineWidth = 3;
    vol.ctx.stroke();
    vol.ctx.restore();
}

/**
 * Draws a 20px X 20px cross hair on the <code>vol.currentQuadrant</code>, at the specified x and y
 */
function drawCrossHair(x, y){
    vol.ctx.moveTo(Math.max(x - 20, 0), y);                              // the horizontal line
    vol.ctx.lineTo(Math.min(x + 20, vol.quadrantWidth), y);
    vol.ctx.moveTo(x, Math.max(y - 20, 0));                              // the vertical line
    vol.ctx.lineTo(x, Math.min(y + 20, vol.quadrantHeight));
}

/**
 * Draws a cross hair on the bigger focus quadrant, at the specified x and y
 */
function drawFocusCrossHair(x, y){
    vol.ctx.moveTo(Math.max(x - 20, 0), y);                              // the horizontal line
    vol.ctx.lineTo(Math.min(x + 20, vol.focusQuadrantWidth), y);
    vol.ctx.moveTo(x, Math.max(y - 20, 0));                              // the vertical line
    vol.ctx.lineTo(x, Math.min(y + 20, vol.focusQuadrantHeight));
}

/**
 * Draws a canvas legend at the bottom of the volume visualizer:
 * <ul>
 * <li>Written min, mean and max values for the data, in scientific notation.
 * <li>Displays the color range for the data.
 * <li>Displays a white bar in to show the currently selected entity value.
 * </ul>
 */
function drawLegend(selectedEntityValue) {
    var tmp = vol.legendPadding / 2;
    // set the context on the legend quadrant
    vol.ctx.setTransform(1, 0, 0, 1, 0, 0);  // reset the transformation
    vol.ctx.translate( vol.quadrantWidth + tmp, vol.focusQuadrantHeight);
    // set the font properties
    vol.ctx.font = '12px Helvetica';
    vol.ctx.textAlign = 'center';
    vol.ctx.textBaseline = 'middle';
    vol.ctx.fillStyle = 'white';
    // write min, mean, max values on the canvas
    vol.ctx.fillText(vol.minimumValue.toExponential(2), 0, vol.legendHeight - 10);
    vol.ctx.fillText("|", 1, vol.legendHeight/2);
    var midValue = (vol.maximumValue - vol.minimumValue)/2;
    vol.ctx.fillText(midValue.toExponential(2), vol.legendWidth/2, vol.legendHeight - 10);
    vol.ctx.fillText("|", vol.legendWidth/2, vol.legendHeight/2);
    vol.ctx.fillText(vol.maximumValue.toExponential(2), vol.legendWidth, vol.legendHeight - 10);
    vol.ctx.fillText("|", vol.legendWidth-1, vol.legendHeight/2);

    // Draw a color bar from min to max value based on the selected color coding
    for(var i = 0; i< vol.legendWidth; i++){
        var val = vol.minimumValue + ((i/vol.legendWidth)*(vol.maximumValue-vol.minimumValue));
        vol.ctx.fillStyle = vol.currentColorScale.getCssColor(val);
        vol.ctx.fillRect(i, 1, 1.5, vol.legendHeight/2);
    }

    // Draw the selected entity value marker on the color bar
    vol.ctx.fillStyle = "white";
    tmp = (selectedEntityValue - vol.minimumValue) / (vol.maximumValue - vol.minimumValue);
    vol.ctx.fillRect(tmp * vol.legendWidth, 1, 3, vol.legendHeight/2);
}

/**
 * Add spatial labels to the navigation quadrants
 */
function drawLabels(focusTxt){
    vol.ctx.font = '15px Helvetica';
    vol.ctx.textBaseline = 'middle';
    _setCtxOnQuadrant(0);
    vol.ctx.fillText("Axial", vol.quadrantWidth/5, vol.quadrantHeight - 13);
    _setCtxOnQuadrant(1);
    vol.ctx.fillText("Sagittal", vol.quadrantWidth/5, vol.quadrantHeight - 13);
    _setCtxOnQuadrant(2);
    vol.ctx.fillText("Coronal", vol.quadrantWidth/5, vol.quadrantHeight - 13);
    _setCtxOnQuadrant(3);
    vol.ctx.fillText(focusTxt, vol.focusQuadrantWidth/2, vol.focusQuadrantHeight - 13);
}

/**
 * Draws a 5px rectangle around the <code>vol.currentQuadrant</code>
 */
function drawMargin(){
    var marginWidth, marginHeight;
    if(vol.currentQuadrant.index === 3){
        marginWidth = vol.focusQuadrantWidth;
        marginHeight = vol.focusQuadrantHeight;
    }
    else{
        marginWidth = vol.quadrantWidth;
        marginHeight = vol.quadrantHeight;
    }
    vol.ctx.beginPath();
    vol.ctx.rect(2, 0, marginWidth - 3, marginHeight - 2);
    vol.ctx.lineWidth = 2;
    if(vol.currentQuadrant.index === vol.highlightedQuad.index){
        vol.ctx.strokeStyle = 'white';
    } else {
        vol.ctx.strokeStyle = 'gray';
    }
    vol.ctx.stroke();
}

function drawMargins(){
    _setCtxOnQuadrant(0);
    drawMargin();
    _setCtxOnQuadrant(1);
    drawMargin();
    _setCtxOnQuadrant(2);
    drawMargin();
    _setCtxOnQuadrant(3);
    drawMargin();
}

function clearCanvas(){
    vol.ctx.setTransform(1, 0, 0, 1, 0, 0);                              // reset the transformation
    vol.ctx.fillStyle = 'rgba(25, 25, 25, 255)'; // todo: take this from the colorscheme theme
    vol.ctx.fillRect(0, 0, vol.ctx.canvas.width, vol.ctx.canvas.height);
}

/**
 * Sets the <code>vol.currentQuadrant</code> and applies transformations on context depending on that
 *
 * @param quadIdx Specifies which of <code>quadrants</code> is selected
 * @private
 */
/* TODO: make it use volumeOrigin; could be like this:
 * <code>vol.ctx.setTransform(1, 0, 0, 1, volumeOrigin[vol.currentQuadrant.axes.x], volumeOrigin[vol.currentQuadrant.axes.y])</code>
 *       if implemented, also change the picking to take it into account
 */
function _setCtxOnQuadrant(quadIdx){
    vol.currentQuadrant = vol.quadrants[quadIdx];
    vol.ctx.setTransform(1, 0, 0, 1, 0, 0);                              // reset the transformation
    // Horizontal Mode
    //vol.ctx.translate(quadIdx * vol.quadrantWidth + vol.currentQuadrant.offsetX, vol.currentQuadrant.offsetY);
    // Vertical Mode
    if(quadIdx === 3){
       vol.ctx.translate(vol.quadrantWidth + vol.currentQuadrant.offsetX, vol.currentQuadrant.offsetY);
    }
    else{
        vol.ctx.translate(vol.currentQuadrant.offsetX, quadIdx * vol.quadrantHeight +  vol.currentQuadrant.offsetY);
    }
}

/**
 * Returns the number of elements on the given axis
 * @param axis The axis whose length is returned; i=0, j=1, k=2
 * @returns {*}
 * @private
 */
function _getDataSize(axis){
    return vol.dataSize[axis + 1];
}

/**
 * Computes the actual dimension of one entity from the specified axes
 * @param xAxis The axis to be represented on X (i=0, j=1, k=2)
 * @param yAxis The axis to be represented on Y (i=0, j=1, k=2)
 * @returns {{width: number, height: number}} Entity width and height
 */
function _getEntityDimensions(xAxis, yAxis){
    var scaleOnWidth  = vol.quadrantWidth  / (_getDataSize(xAxis) * vol.voxelSize[xAxis]);
    var scaleOnHeight = vol.quadrantHeight / (_getDataSize(yAxis) * vol.voxelSize[yAxis]);
    var scale = Math.min(scaleOnHeight, scaleOnWidth);
    return {width: vol.voxelSize[xAxis] * scale, height: vol.voxelSize[yAxis] * scale};
}

/**
 * Computes the actual dimension of one entity from the specified axes
 * To be used to set the dimensions of data on the "focus" Quadrant
 * @param xAxis The axis to be represented on X (i=0, j=1, k=2)
 * @param yAxis The axis to be represented on Y (i=0, j=1, k=2)
 * @returns {{width: number, height: number}} Entity width and height
 */
function _getFocusEntityDimensions(xAxis, yAxis){
    var scaleOnWidth  = vol.focusQuadrantWidth  / (_getDataSize(xAxis) * vol.voxelSize[xAxis]);
    var scaleOnHeight = vol.focusQuadrantHeight / (_getDataSize(yAxis) * vol.voxelSize[yAxis]);
    var scale = Math.min(scaleOnHeight, scaleOnWidth);
    return {width: vol.voxelSize[xAxis] * scale, height: vol.voxelSize[yAxis] * scale};
}

/**
 * Initializes the <code>vol.quadrants</code> with some default axes and sets their properties
 */
function _setupQuadrants(){
    vol.quadrants.push(new Quadrant({ index: 0, axes: {x: 1, y: 0} }));
    vol.quadrants.push(new Quadrant({ index: 1, axes: {x: 1, y: 2} }));
    vol.quadrants.push(new Quadrant({ index: 2, axes: {x: 0, y: 2} }));

    for (var quadIdx = 0; quadIdx < vol.quadrants.length; quadIdx++){
        var entityDimensions = _getEntityDimensions(vol.quadrants[quadIdx].axes.x, vol.quadrants[quadIdx].axes.y);
        vol.quadrants[quadIdx].entityHeight = entityDimensions.height;
        vol.quadrants[quadIdx].entityWidth  = entityDimensions.width;
        vol.quadrants[quadIdx].offsetY = 0;
        vol.quadrants[quadIdx].offsetX = 0;
    }
}

/**
 * Helper function to setup and add the Focus Quadrant to <code>vol.quadrants</code>.
 */
function _setupFocusQuadrant(selectedQuad){
    if(vol.quadrants.length === 4){
        vol.quadrants.pop();
    }
    var axe = 0;
    if(selectedQuad.index === 0){
        axe = {x: 1, y: 0};
    }
    else if(selectedQuad.index === 1){
        axe = {x: 1, y: 2};
    }
    else{
        axe = {x: 0, y: 2};
    }
    vol.quadrants.push(new Quadrant({ index: 3, axes: axe }));
    var entityDimensions = _getFocusEntityDimensions(vol.quadrants[3].axes.x, vol.quadrants[3].axes.y);
    vol.quadrants[3].entityHeight = entityDimensions.height;
    vol.quadrants[3].entityWidth  = entityDimensions.width;
    vol.quadrants[3].offsetY = 0;
    vol.quadrants[3].offsetX = 0;
}

/**
 * Given a mouse event it returns information on what quadrant and what point in said quadrant was hit.
 * Returns undefined if nothing interesting was hit.
 * @returns {{selectedQuad: Quadrant, selectedEntityOnX: number, selectedEntityOnY: number} || undefined }
 */
function TSV_hitTest(e){
    //fix for Firefox
    var offset = $('#canvasVolumes').offset();
    var xpos = e.pageX - offset.left;
    var ypos = e.pageY - offset.top;
    //var selectedQuad = vol.quadrants[Math.floor(xpos / vol.quadrantWidth)];
    var selectedQuad;

    if(Math.floor(xpos / vol.quadrantWidth) >= 1){
        selectedQuad = vol.quadrants[3];
        // check if it's inside the focus quadrant but outside the drawing
        if (ypos < selectedQuad.offsetY ){
            return;
        }
        else if(ypos >= vol.focusQuadrantHeight - selectedQuad.offsetY){
            return;
        }
        else if(xpos >= vol.focusQuadrantWidth - selectedQuad.offsetX + vol.quadrantWidth){
            return;
        }
    } else{
        selectedQuad = vol.quadrants[Math.floor(ypos / vol.quadrantHeight)];
        _setupFocusQuadrant(selectedQuad);
        // check if it's inside the quadrant but outside the drawing
        if (ypos < selectedQuad.offsetY ){
            return;
        }
        else if(ypos >= vol.quadrantHeight * (selectedQuad.index + 1) - selectedQuad.offsetY){
            return;
        }
        else if(xpos >= vol.quadrantWidth - selectedQuad.offsetX){
            return;
        }
    }

    var selectedEntityOnX = 0;
    var selectedEntityOnY = 0;

    if(selectedQuad.index === 3){
        selectedEntityOnX = Math.floor(((xpos - vol.quadrantWidth) % vol.focusQuadrantWidth) / selectedQuad.entityWidth);
        selectedEntityOnY = Math.floor(((ypos - selectedQuad.offsetY) % vol.focusQuadrantHeight) / selectedQuad.entityHeight);
    } else{
        selectedEntityOnX = Math.floor((xpos - selectedQuad.offsetX) / selectedQuad.entityWidth);
        selectedEntityOnY = Math.floor((ypos % vol.quadrantHeight) / selectedQuad.entityHeight);
    }

    if (selectedQuad.index !== 3){
        vol.highlightedQuad = selectedQuad;
    }

    return {
        selectedQuad: selectedQuad,
        selectedEntityOnX: selectedEntityOnX,
        selectedEntityOnY: selectedEntityOnY
    };
}

/**
 * Returns the quadrant object at index quadID
 * @returns {Quadrant}
 */
function TSV_getQuadrant(quadID){
    return vol.quadrants[quadID];
}

// MODULE EXPORTS
window.TSV_initVolumeView = TSV_initVolumeView;
window.TSV_drawVolumeScene = TSV_drawVolumeScene;
window.TSV_hitTest = TSV_hitTest;
window.TSV_getQuadrant = TSV_getQuadrant;
// for debug otherwise keep this state private
window._debug_vol = vol;

})();