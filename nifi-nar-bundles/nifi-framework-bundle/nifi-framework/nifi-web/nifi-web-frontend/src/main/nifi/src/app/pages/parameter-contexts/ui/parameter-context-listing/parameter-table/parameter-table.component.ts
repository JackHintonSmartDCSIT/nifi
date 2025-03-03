/*
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with
 * the License.  You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { AfterViewInit, ChangeDetectorRef, Component, forwardRef, Input } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';
import { MatTableDataSource, MatTableModule } from '@angular/material/table';
import { AsyncPipe, NgTemplateOutlet } from '@angular/common';
import { CdkConnectedOverlay, CdkOverlayOrigin } from '@angular/cdk/overlay';
import { RouterLink } from '@angular/router';
import { NiFiCommon } from '../../../../../service/nifi-common.service';
import { Parameter, ParameterEntity, TextTipInput } from '../../../../../state/shared';
import { NifiTooltipDirective } from '../../../../../ui/common/tooltips/nifi-tooltip.directive';
import { TextTip } from '../../../../../ui/common/tooltips/text-tip/text-tip.component';
import { Observable, take } from 'rxjs';
import { ParameterReferences } from '../../../../../ui/common/parameter-references/parameter-references.component';
import { Store } from '@ngrx/store';
import { ParameterContextListingState } from '../../../state/parameter-context-listing';
import { showOkDialog } from '../../../state/parameter-context-listing/parameter-context-listing.actions';

export interface ParameterItem {
    deleted: boolean;
    dirty: boolean;
    added: boolean;
    entity: ParameterEntity;
}

@Component({
    selector: 'parameter-table',
    standalone: true,
    templateUrl: './parameter-table.component.html',
    imports: [
        MatButtonModule,
        MatDialogModule,
        MatTableModule,
        NgTemplateOutlet,
        CdkOverlayOrigin,
        CdkConnectedOverlay,
        RouterLink,
        AsyncPipe,
        NifiTooltipDirective,
        ParameterReferences
    ],
    styleUrls: ['./parameter-table.component.scss'],
    providers: [
        {
            provide: NG_VALUE_ACCESSOR,
            useExisting: forwardRef(() => ParameterTable),
            multi: true
        }
    ]
})
export class ParameterTable implements AfterViewInit, ControlValueAccessor {
    @Input() createNewParameter!: (existingParameters: string[]) => Observable<Parameter>;
    @Input() editParameter!: (parameter: Parameter) => Observable<Parameter>;
    @Input() canAddParameters = true;

    protected readonly TextTip = TextTip;

    displayedColumns: string[] = ['name', 'value', 'actions'];
    dataSource: MatTableDataSource<ParameterItem> = new MatTableDataSource<ParameterItem>();
    selectedItem: ParameterItem | null = null;

    isDisabled = false;
    isTouched = false;
    onTouched!: () => void;
    onChange!: (parameters: ParameterEntity[]) => void;

    constructor(
        private store: Store<ParameterContextListingState>,
        private changeDetector: ChangeDetectorRef,
        private nifiCommon: NiFiCommon
    ) {}

    ngAfterViewInit(): void {
        this.initFilter();
    }

    initFilter(): void {
        this.dataSource.filterPredicate = (data: ParameterItem) => this.isVisible(data);
        this.dataSource.filter = ' ';
    }

    isVisible(item: ParameterItem): boolean {
        return !item.deleted;
    }

    registerOnChange(onChange: (parameters: ParameterEntity[]) => void): void {
        this.onChange = onChange;
    }

    registerOnTouched(onTouch: () => void): void {
        this.onTouched = onTouch;
    }

    setDisabledState(isDisabled: boolean): void {
        this.isDisabled = isDisabled;
    }

    writeValue(parameters: ParameterEntity[]): void {
        const propertyItems: ParameterItem[] = parameters.map((entity) => {
            const item: ParameterItem = {
                deleted: false,
                added: false,
                dirty: false,
                entity: {
                    ...entity,
                    parameter: {
                        ...entity.parameter
                    }
                }
            };

            return item;
        });

        this.setPropertyItems(propertyItems);
    }

    private setPropertyItems(parameterItems: ParameterItem[]): void {
        this.dataSource = new MatTableDataSource<ParameterItem>(parameterItems);
        this.initFilter();
    }

    newParameterClicked(): void {
        // get the existing parameters to provide to the new parameter dialog but
        // exclude any items that are currently marked for deletion which can be
        // unmarked for deletion if the user chooses to enter the same name
        const existingParameters: string[] = this.dataSource.data
            .filter((item) => !item.deleted)
            .map((item) => item.entity.parameter.name);

        this.createNewParameter(existingParameters)
            .pipe(take(1))
            .subscribe((parameter) => {
                const currentParameterItems: ParameterItem[] = this.dataSource.data;

                // identify if a parameter with the same name already exists (must have been marked
                // for deletion already)
                const item: ParameterItem | undefined = currentParameterItems.find(
                    (item) => item.entity.parameter.name === parameter.name
                );

                if (item) {
                    // if the item is added that means it hasn't been saved yet. in this case, we
                    // can simply update the existing parameter. if the item has been saved, and the
                    // sensitivity has changed, the user must apply the changes first.
                    if (!item.added && item.entity.parameter.sensitive !== parameter.sensitive) {
                        this.store.dispatch(
                            showOkDialog({
                                title: 'Parameter Exists',
                                message:
                                    'A parameter with this name has been marked for deletion. Please apply this change to delete this parameter from the parameter context before recreating it with a different sensitivity.'
                            })
                        );
                        return;
                    }

                    // update the existing item
                    item.deleted = false;
                    item.entity.parameter = {
                        ...parameter
                    };
                } else {
                    const newItem: ParameterItem = {
                        deleted: false,
                        added: true,
                        dirty: true,
                        entity: {
                            canWrite: true,
                            parameter: {
                                ...parameter
                            }
                        }
                    };
                    const parameterItems: ParameterItem[] = [...currentParameterItems, newItem];
                    this.setPropertyItems(parameterItems);
                }

                this.handleChanged();
            });
    }

    hasDescription(item: ParameterItem): boolean {
        return !this.nifiCommon.isBlank(item.entity.parameter.description);
    }

    getDescriptionTipData(item: ParameterItem): TextTipInput {
        return {
            text: item.entity.parameter.description
        };
    }

    isSensitiveParameter(item: ParameterItem): boolean {
        return item.entity.parameter.sensitive;
    }

    isNull(value: string): boolean {
        return value == null;
    }

    isEmptyString(value: string): boolean {
        return value == '';
    }

    hasExtraWhitespace(value: string): boolean {
        return this.nifiCommon.hasLeadTrailWhitespace(value);
    }

    getExtraWhitespaceTipData(): TextTipInput {
        return {
            text: 'The specified value contains leading and/or trailing whitespace character(s). This could produce unexpected results if it was not intentional.'
        };
    }

    canGoToParameter(item: ParameterItem): boolean {
        return (
            item.entity.parameter.inherited == true &&
            item.entity.parameter.parameterContext?.permissions.canRead == true
        );
    }

    getParameterLink(item: ParameterItem): string[] {
        if (item.entity.parameter.parameterContext) {
            // TODO - support routing directly to a parameter
            return ['/parameter-contexts', item.entity.parameter.parameterContext.id, 'edit'];
        }
        return [];
    }

    canEdit(item: ParameterItem): boolean {
        const canWrite: boolean = item.entity.canWrite == true;
        const provided: boolean = item.entity.parameter.provided == true;
        const inherited: boolean = item.entity.parameter.inherited == true;
        return canWrite && !provided && !inherited;
    }

    editClicked(item: ParameterItem): void {
        this.editParameter(item.entity.parameter)
            .pipe(take(1))
            .subscribe((parameter) => {
                const valueChanged: boolean = item.entity.parameter.value != parameter.value;
                const descriptionChanged: boolean = item.entity.parameter.description != parameter.description;
                const valueRemovedChanged: boolean = item.entity.parameter.valueRemoved != parameter.valueRemoved;

                if (valueChanged || descriptionChanged || valueRemovedChanged) {
                    item.entity.parameter.value = parameter.value;
                    item.entity.parameter.description = parameter.description;
                    item.entity.parameter.valueRemoved = parameter.valueRemoved;
                    item.dirty = true;

                    this.handleChanged();
                }
            });
    }

    canDelete(item: ParameterItem): boolean {
        const canWrite: boolean = item.entity.canWrite == true;
        const provided: boolean = item.entity.parameter.provided == true;
        const inherited: boolean = item.entity.parameter.inherited == true;
        return canWrite && !provided && !inherited;
    }

    deleteClicked(item: ParameterItem): void {
        if (!item.deleted) {
            item.entity.parameter.value = null;
            item.entity.parameter.valueRemoved = true;
            item.deleted = true;
            item.dirty = true;
            this.selectParameter(null);
            this.handleChanged();
        }
    }

    private handleChanged() {
        // this is needed to trigger the filter to be reapplied
        this.dataSource._updateChangeSubscription();
        this.changeDetector.markForCheck();

        // mark the component as touched if not already
        if (!this.isTouched) {
            this.isTouched = true;
            this.onTouched();
        }

        // emit the changes
        this.onChange(this.serializeParameters());
    }

    private serializeParameters(): any[] {
        const parameters: ParameterItem[] = this.dataSource.data;

        // only include dirty items
        return parameters
            .filter((item) => item.dirty)
            .filter((item) => !(item.added && item.deleted))
            .map((item) => {
                if (item.deleted) {
                    return {
                        parameter: {
                            name: item.entity.parameter.name
                        }
                    };
                } else {
                    return {
                        parameter: {
                            name: item.entity.parameter.name,
                            sensitive: item.entity.parameter.sensitive,
                            description: item.entity.parameter.description,
                            value: item.entity.parameter.value
                        }
                    };
                }
            });
    }

    selectParameter(item: ParameterItem | null): void {
        this.selectedItem = item;
    }

    isSelected(item: ParameterItem): boolean {
        if (this.selectedItem) {
            return item.entity.parameter.name == this.selectedItem.entity.parameter.name;
        }
        return false;
    }
}
